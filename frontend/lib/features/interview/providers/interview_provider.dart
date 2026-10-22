import 'dart:async';
import 'dart:convert';
import '../models/interview_state.dart';
import '../models/speech_failure.dart';
export '../models/interview_state.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/network/websocket_client.dart';
import '../../../shared/services/stt_service.dart';
import '../../../shared/services/system_speech_stt_service.dart';
import '../../../shared/services/aws_transcribe_stt_service.dart';
import '../../../core/env.dart';
import '../../../core/voice_policy.dart';
import '../../../shared/services/tts_service.dart';

part 'interview_response_recovery.dart';

/// Factory seam for the interview WebSocket so tests can inject a fake socket
/// without opening a real network connection. Production uses [_defaultWsFactory].
typedef WebSocketClientFactory =
    WebSocketClient Function({
      required String url,
      required String userId,
      required String sessionId,
    });

class InterviewProvider extends ChangeNotifier {
  InterviewPhase _currentPhase = InterviewPhase.ready;
  InterviewPhase get currentPhase => _currentPhase;

  String? sessionId;
  String? moduleType;
  String? currentQuestion;
  String? audioUrl;
  List<TranscriptEntry> transcript = [];
  String? errorMessage;
  String? recordingNotice;
  String _selectedVoiceId = 'Ruth';
  // COST: must match the backend default (POLLY_DEFAULT_ENGINE, 'neural').
  // The backend overrides whatever the client sends, so 'generative' here was
  // only ever misleading — but if the override is relaxed it would silently
  // double the Polly bill ($30 vs $16 per 1M chars).
  String _selectedEngine = 'neural';

  // 'cost_saver' (neural) or 'premium' (generative). Drives which engine the
  // backend is allowed to use for Polly synthesis.
  String _voiceMode = 'cost_saver';

  String get selectedVoiceId => _selectedVoiceId;
  String get selectedEngine => _selectedEngine;
  String get voiceMode => _voiceMode;

  void setVoice(
    String voiceId, {
    String? engine,
    String voiceMode = 'cost_saver',
  }) {
    _selectedVoiceId = VoicePolicy.resolve(voiceId);
    _voiceMode = 'cost_saver';
    _selectedEngine = 'neural';
    _safeNotify();
  }

  // Additional properties for screen compatibility
  String questionText = "...";
  String finalQuestionText = "";
  String subtitleText = "";
  bool isStreamingText = false;
  String partialTranscript = "";
  String finalTranscript = "";
  bool isConnecting = false;
  bool isListening = false;
  bool isPreparingVoice = false;
  bool isSessionEnded = false;
  String? terminationReason;
  bool? feedbackExpected;
  int _silenceStrikes = 0;
  int get silenceStrikes => _silenceStrikes;

  WebSocketClient? _wsClient;
  final SttService _sttService;
  Map<String, dynamic> get speechDiagnostics => _sttService.diagnostics;
  final TtsService _ttsService;
  final FirebaseAuth? _injectedAuth;
  final WebSocketClientFactory _wsFactory;

  // Resolved lazily so the default constructor never touches
  // FirebaseAuth.instance at build time (it requires Firebase.initializeApp and
  // throws under the test binding); production reads it only inside initSession.
  FirebaseAuth get _auth => _injectedAuth ?? FirebaseAuth.instance;

  StreamSubscription? _wsSubscription;
  final List<StreamSubscription> _socketSubscriptions = [];
  int _socketGeneration = 0;
  int _captureId = 0;
  int _segmentId = 0;
  bool _captureFinalized = true;
  bool _captureClosing = false;
  Timer? _restartTimer;
  Timer? _safetyTimer;
  Timer? _terminationTimer;
  Timer? _responseTimer;
  Timer? _recoveryTimer;
  bool _restartingSegment = false;
  bool _segmentRecoveryRequested = false;
  int _microphoneRetries = 0;
  int _responseRetries = 0;
  bool _transportLost = false;
  bool _refreshCredentials = false;
  bool _connectingTransport = false;
  int _recoveryOperation = 0;
  int _connectionEpoch = 0;
  String? _requestId;
  final Set<String> _resolvedRequests = {};
  Map<String, dynamic>? _initialRequest;
  bool _heardCaptureSpeech = false;
  String? _captureClosingFailure;
  bool get isFinalizingTranscript => _captureClosing;
  int recoveryAttempt = 0;
  bool _awaitingReconnect = false;
  bool _questionHeard = false;
  String? _questionAudioData;
  bool _suspended = false;
  bool _recoveryStopped = false;
  String? _currentTurnId;
  String? _recoveredQuestion;
  bool _expectsAnswer = true;
  bool _audioRefreshable = false;
  Completer<Map<String, dynamic>>? _audioRefresh;
  int _audioRetries = 0;
  String _segments = '';
  Map<String, dynamic>? _pendingAnswer;
  bool _answerAcknowledged = false;
  bool microphoneAvailable = true;
  int _playbackId = 0;
  int _lastTurnIndex = -1;
  final Set<String> _completedTurns = {};
  final Map<String, int> _streamSequences = {};
  static const silenceDuration = Duration(seconds: 40);
  static const initialThinkingDuration = silenceDuration;
  static const maxRecoveryAttempts = 3;
  bool get hasPendingAnswer => _pendingAnswer != null;
  String? get currentQuestionIdentity => _currentTurnId;
  bool get replayQuestionAvailable =>
      _recoveredQuestion != null &&
      _recoveredQuestion == _currentTurnId &&
      _expectsAnswer &&
      !_isEnding &&
      !isSessionEnded &&
      !_recoveryStopped;
  bool get canReplayQuestion =>
      replayQuestionAvailable &&
      !_suspended &&
      !isConnecting &&
      _pendingAnswer == null &&
      !_captureClosing &&
      (_currentPhase == InterviewPhase.listening ||
          _currentPhase == InterviewPhase.ready);
  bool get needsScreenAwake =>
      !_isEnding &&
      !isSessionEnded &&
      !_suspended &&
      !_recoveryStopped &&
      _currentPhase != InterviewPhase.error &&
      (isConnecting || sessionId != null);

  // R-09 (account isolation): one generation per identity/session epoch. It is
  // bumped on every UID transition (resetForUser) AND every fresh session start
  // (resetForNewSession), so A->logout->A yields distinct generations. Every
  // multi-step async flow — initSession and the STT/TTS turn callbacks — captures
  // the generation it started under and refuses to open a socket, send a frame,
  // retry the mic, or paint a transcript once it no longer matches. A slow init
  // or a late STT result belonging to account A can therefore never continue
  // inside account B's live session, and a flow orphaned by logout dies quietly.
  int _generation = 0;

  @visibleForTesting
  int get generation => _generation;
  int get sessionGeneration => _generation;

  bool _isStale(int gen) => gen != _generation;

  static WebSocketClient _defaultWsFactory({
    required String url,
    required String userId,
    required String sessionId,
  }) => WebSocketClient(url: url, userId: userId, sessionId: sessionId);

  /// [sttService], [ttsService], [auth] and [wsFactory] are injectable for
  /// tests; production falls back to the real services, FirebaseAuth, and a live
  /// socket, so `InterviewProvider()` with no arguments is unchanged behaviour.
  InterviewProvider({
    SttService? sttService,
    TtsService? ttsService,
    FirebaseAuth? auth,
    WebSocketClientFactory? wsFactory,
  }) : _sttService = sttService ?? defaultSttService(),
       _ttsService = ttsService ?? TtsService(),
       _injectedAuth = auth,
       _wsFactory = wsFactory ?? _defaultWsFactory;

  static SttService defaultSttService() => Env.awsSttEnabled
      ? AwsTranscribeSttService(
          language: Env.awsSttLanguage,
          stability: Env.awsSttStability,
          pause: Duration(
            milliseconds: Env.awsSttPauseMs < 4000 ? 4000 : Env.awsSttPauseMs,
          ),
        )
      : SystemSpeechSttService();

  void _cancelSocketSubscriptions() {
    _socketGeneration++;
    _wsSubscription?.cancel();
    _wsSubscription = null;
    for (final subscription in _socketSubscriptions) {
      subscription.cancel();
    }
    _socketSubscriptions.clear();
  }

  void _initWebSocket() {
    final ws = _wsClient;
    if (ws == null) return;
    ws.useExternalRecovery();
    _cancelSocketSubscriptions();
    final socketGen = _socketGeneration;
    final gen = _generation;
    bool valid() =>
        !_isStale(gen) &&
        socketGen == _socketGeneration &&
        identical(ws, _wsClient) &&
        !_isEnding &&
        !_recoveryStopped &&
        !_suspended;
    _wsSubscription = ws.messages.listen((message) {
      if (valid()) _handleWebSocketMessage(message);
    });
    _socketSubscriptions.add(
      ws.errors.listen((error) {
        if (!valid()) return;
        errorMessage = error;
        _safeNotify();
      }),
    );
    _socketSubscriptions.add(
      ws.disconnects.listen((_) {
        if (!valid() || isSessionEnded) return;
        _currentPhase = InterviewPhase.reconnecting;
        isConnecting = true;
        _responseTimer?.cancel();
        _recoveryTimer?.cancel();
        _awaitingReconnect = true;
        _transportLost = true;
        _pauseCapture();
        _cancelPlayback();
        _ttsService.stop().catchError((Object _) {});
        errorMessage = 'Connection lost. Reconnecting to your interview…';
        _scheduleResponseRecovery();
        _safeNotify();
      }),
    );
    _socketSubscriptions.add(
      ws.reconnects.listen((_) {
        if (!valid() || isSessionEnded || sessionId == null) return;
        _transportLost = false;
        _recoveryTimer?.cancel();
        _requestReconnect();
      }),
    );
    _socketSubscriptions.add(
      ws.retryCounts.listen((attempt) {
        if (!valid()) return;
        recoveryAttempt = attempt;
        errorMessage = 'Reconnecting automatically ($attempt/3)…';
        _safeNotify();
      }),
    );
    _socketSubscriptions.add(
      ws.reconnectExhausted.listen((_) {
        if (!valid()) return;
        _recoveryTimer?.cancel();
        _responseTimer?.cancel();
        _stopRecovery(
          'Connection recovery stopped after 3 attempts. Your answer is kept in this session. You can end the interview.',
        );
      }),
    );
  }

  void _safeNotify() {
    if (!hasListeners) return;
    try {
      notifyListeners();
    } catch (e) {
      debugPrint('Safe notify error: $e');
    }
  }

  void _handleWebSocketMessage(Map<String, dynamic> message) {
    final payload = message['payload'];
    if (payload is Map &&
        payload['sessionId'] != null &&
        payload['sessionId'] != sessionId) {
      return;
    }
    switch (message['type']) {
      case 'turn_ack':
        if (payload['clientTurnId'] == _pendingAnswer?['clientTurnId']) {
          _answerAcknowledged = true;
        }
        break;
      case 'reconnect_ack':
        if (payload['state'] == 'ERROR') {
          _stopRecovery(
            'The server stopped this interview. Your draft is kept. Please end the interview.',
          );
          return;
        }
        isConnecting = false;
        errorMessage = null;
        if (payload['clientTurnId'] == _pendingAnswer?['clientTurnId']) {
          _answerAcknowledged = true;
        }
        if (_pendingAnswer != null && !_answerAcknowledged) {
          _sendPendingAnswer();
        } else {
          _armResponseWatchdog();
        }
        _currentPhase = InterviewPhase.processing;
        _safeNotify();
        break;
      case 'question_audio':
        if (payload['turnId'] == _currentTurnId &&
            _audioRefresh?.isCompleted == false) {
          _audioRefresh!.complete(Map<String, dynamic>.from(payload));
        }
        break;
      case 'text_stream':
        _handleTextStream(message['payload']);
        break;
      case 'turn_complete':
        _handleTurnComplete(message['payload']);
        break;
      case 'turn_error':
        _handleTurnError(message['payload']);
        break;
      case 'termination':
        _handleTermination(Map<String, dynamic>.from(message['payload'] ?? {}));
        break;
      case 'error':
        _handleTurnError(Map<String, dynamic>.from(message['payload']));
        break;
    }
  }

  void _handleTextStream(Map<String, dynamic> payload) {
    final turnId = payload['turnId']?.toString();
    final index = payload['turnIndex'] as int?;
    if (index != null && index < _lastTurnIndex) return;
    if (turnId != null) {
      if (_completedTurns.contains(turnId)) return;
      final sequence = payload['sequence'] as int? ?? 0;
      if (sequence <= (_streamSequences[turnId] ?? -1)) return;
      _streamSequences[turnId] = sequence;
    }
    if (_currentPhase != InterviewPhase.speaking) {
      _currentPhase = InterviewPhase.speaking;
    }
    isStreamingText = true;
    subtitleText = payload['fullText'] ?? subtitleText;
    questionText = subtitleText;
    _safeNotify();
  }

  void _handleTurnComplete(Map<String, dynamic> payload) {
    final index = payload['turnIndex'] as int? ?? 0;
    final turnId = payload['turnId']?.toString() ?? '$sessionId#$index';
    if (index < _lastTurnIndex) return;
    if (_completedTurns.contains(turnId)) {
      if (_awaitingReconnect && _pendingAnswer != null) {
        _awaitingReconnect = false;
        _currentPhase = InterviewPhase.processing;
        isConnecting = false;
        _sendPendingAnswer();
        _safeNotify();
        return;
      }
      if ((_awaitingReconnect ||
              _currentPhase == InterviewPhase.reconnecting) &&
          _pendingAnswer == null) {
        if (turnId != _currentTurnId || !_expectsAnswer) return;
        _recoveredQuestion = turnId;
        // Reconnect can refresh audio while keeping the same question/draft.
        if ((payload['audioUrl'] as String?)?.isNotEmpty == true) {
          audioUrl = payload['audioUrl'];
        }
        if ((payload['audioData'] as String?)?.isNotEmpty == true) {
          _questionAudioData = payload['audioData'];
        }
        _audioRefreshable =
            payload['audioRefreshable'] == true || _audioRefreshable;
        _awaitingReconnect = false;
        _responseTimer?.cancel();
        _recoveryTimer?.cancel();
        recoveryAttempt = 0;
        _currentPhase = InterviewPhase.ready;
        isConnecting = false;
        errorMessage = null;
        if (_questionHeard) {
          _startListening(preserve: true);
        } else {
          _playQuestion(_questionAudioData, preserveDraft: true);
        }
      }
      return;
    }
    _lastTurnIndex = index;
    _recoveryOperation++;
    _connectionEpoch++;
    _connectingTransport = false;
    if (_requestId != null) _resolvedRequests.add(_requestId!);
    if (_resolvedRequests.length > 64) {
      _resolvedRequests.remove(_resolvedRequests.first);
    }
    _completedTurns.add(turnId);
    final recovered = _awaitingReconnect;
    _currentTurnId = turnId;
    _expectsAnswer = payload['expectsAnswer'] != false;
    _recoveredQuestion = recovered && _expectsAnswer ? turnId : null;
    _audioRefreshable = payload['audioRefreshable'] == true;
    _audioRetries = _microphoneRetries = 0;
    _wsClient?.markReconciled();
    _responseTimer?.cancel();
    _recoveryTimer?.cancel();
    _awaitingReconnect = false;
    _responseRetries = 0;
    recoveryAttempt = 0;
    _pendingAnswer = null;
    _answerAcknowledged = false;
    isConnecting = false;
    isStreamingText = false;
    errorMessage = null;
    final text = payload['questionText'] as String?;
    if (text == null || text.trim().isEmpty) {
      _handleTurnError({'error': 'Invalid interview response. Please resume.'});
      return;
    }
    transcript.add(
      TranscriptEntry(role: 'AI', text: text, timestamp: DateTime.now()),
    );
    currentQuestion = questionText = finalQuestionText = subtitleText = text;
    audioUrl = payload['audioUrl'] as String?;
    _questionHeard = false;
    _questionAudioData = payload['audioData'] as String?;
    // Drafts belong to one server question, including when a disconnect happened
    // during the previous question's playback.
    _segments = partialTranscript = finalTranscript = '';
    _playQuestion(_questionAudioData, expectsAnswer: _expectsAnswer);
  }

  Future<void> _playQuestion(
    String? audioData, {
    bool expectsAnswer = true,
    bool preserveDraft = false,
  }) async {
    if (_isEnding || isSessionEnded || _suspended || _recoveryStopped) return;
    final gen = _generation;
    final sid = sessionId, question = _currentTurnId;
    final playback = ++_playbackId;
    bool valid() =>
        !_isStale(gen) &&
        playback == _playbackId &&
        sid == sessionId &&
        question == _currentTurnId &&
        !_suspended &&
        (!_isEnding || _pendingTermination) &&
        !_recoveryStopped;
    final elapsed = Stopwatch()..start();
    _restartTimer?.cancel();
    _responseTimer?.cancel();
    _recoveryTimer?.cancel();
    if (preserveDraft && !_captureFinalized) {
      _captureClosing =
          true; // keep final words alive, but prohibit submission/restart
      isListening = false;
    } else {
      _pauseCapture();
    }
    _currentPhase = InterviewPhase.speaking;
    _safeNotify();
    try {
      try {
        await _sttService.stopCaptureAndFlush().timeout(
          const Duration(seconds: 10),
        );
      } catch (failure) {
        // An unfinished hypothesis is preserved, not submitted. The service
        // has cancelled capture before throwing these final-result failures.
        final unfinished =
            failure is StateError &&
            (failure.message == 'speech_final_missing' ||
                failure.message == 'speech_not_transcribed');
        if (valid() && !unfinished) {
          _stopRecovery(
            'Microphone could not stop safely. Your draft is kept. Please end the interview.',
          );
        }
        if (!unfinished) return;
      }
      if (!valid()) return;
      _pauseCapture();
      if (expectsAnswer && !preserveDraft && sid != null && question != null) {
        // Hide permission/recorder allocation and ticket latency under playback.
        // The microphone and paid recognition stream remain stopped.
        unawaited(
          _sttService
              .prewarmQuestion(
                sessionId: sid,
                turnId: question,
                identity: '$sid:$gen:$question',
              )
              .catchError((Object _) {}),
        );
      }
      var refreshed = false;
      while (valid()) {
        try {
          if (audioUrl?.isNotEmpty == true) {
            await _ttsService
                .playUrl(audioUrl!)
                .timeout(const Duration(seconds: 60));
          } else if (audioData?.isNotEmpty == true) {
            await _ttsService
                .playBase64(audioData!)
                .timeout(const Duration(seconds: 60));
          }
          if (!valid()) return;
          errorMessage = null;
          recoveryAttempt = 0;
          _questionHeard = true;
          break;
        } catch (_) {
          await _ttsService.stop().timeout(const Duration(seconds: 5));
          if (!valid()) return;
          if (_audioRetries >= maxRecoveryAttempts) rethrow;
          recoveryAttempt = ++_audioRetries;
          if (!refreshed && _audioRefreshable && audioUrl?.isNotEmpty == true) {
            refreshed = true;
            final refreshedUrl = await _refreshQuestionAudio(question!);
            if (!valid()) return;
            if (refreshedUrl != null) audioUrl = refreshedUrl;
          }
          errorMessage =
              'Retrying question audio automatically ($recoveryAttempt/3)…';
          _safeNotify();
          await Future<void>.delayed(const Duration(seconds: 1));
          if (!valid()) return;
        }
      }
    } catch (_) {
      if (!valid()) return;
      errorMessage =
          'Audio is unavailable after automatic recovery. Read the question above and answer aloud.';
    } finally {
      debugPrint(
        'Qlue metric=app_playback durationMs=${elapsed.elapsedMilliseconds}',
      );
      if (!_isStale(gen) &&
          playback == _playbackId &&
          !_suspended &&
          !_recoveryStopped) {
        try {
          await _ttsService.stop().timeout(const Duration(seconds: 5));
        } catch (_) {
          errorMessage =
              'Audio could not stop safely. Please end the interview.';
          _currentPhase = InterviewPhase.error;
          _safeNotify();
          return;
        }
        if (!_isStale(gen) && playback == _playbackId && !_suspended) {
          if (_pendingTermination) {
            _finalizeTermination();
          } else if (expectsAnswer && !_isEnding) {
            _startListening(preserve: preserveDraft);
          } else {
            _currentPhase = InterviewPhase.processing;
            _safeNotify();
          }
        }
      }
    }
  }

  Future<void> replayQuestion() {
    if (!canReplayQuestion) return Future.value();
    // _playQuestion closes the tap gate synchronously, before its first await.
    return _playQuestion(_questionAudioData, preserveDraft: true);
  }

  Future<String?> _refreshQuestionAudio(String turnId) async {
    final request = _audioRefresh = Completer<Map<String, dynamic>>();
    _wsClient?.sendMessage({
      'type': 'session_reconnect',
      'payload': {'sessionId': sessionId, 'turnId': turnId, 'audioOnly': true},
    });
    try {
      final result = await request.future.timeout(const Duration(seconds: 5));
      return result['audioUrl'] as String?;
    } on TimeoutException {
      return null;
    } finally {
      if (identical(_audioRefresh, request)) _audioRefresh = null;
    }
  }

  void _cancelPlayback() {
    _playbackId++;
    if (_audioRefresh?.isCompleted == false) _audioRefresh!.complete({});
    _audioRefresh = null;
  }

  void _stopRecovery(String message) {
    _recoveryStopped = true;
    _recoveredQuestion = null;
    _pauseCapture();
    _cancelPlayback();
    _responseTimer?.cancel();
    _recoveryTimer?.cancel();
    _ttsService.stop().catchError((Object _) {});
    _wsClient?.disconnect();
    isConnecting = false;
    _currentPhase = InterviewPhase.error;
    errorMessage = message;
    _safeNotify();
  }

  // GLITCH FIX (self-intro cutoff): the server sends 'termination' right
  // after the final turn's audio starts playing. Cleaning up immediately
  // stopped the player, so the closing message appeared as text but was
  // never spoken. If audio is playing, defer finalization until playback
  // completes (the playback .then always routes through _startListening,
  // which finalizes below); a 30s safety timer guarantees we never hang.
  bool _pendingTermination = false;

  void _handleTermination(Map<String, dynamic> payload) {
    _recordTerminationOutcome(payload);
    _isEnding = true;
    _pauseCapture();
    _safeNotify(); // release foreground screen-awake immediately
    if (_currentPhase == InterviewPhase.speaking) {
      _pendingTermination = true;
      final gen = _generation;
      _terminationTimer?.cancel();
      _terminationTimer = Timer(const Duration(seconds: 30), () {
        if (_isStale(gen)) return;
        if (_pendingTermination) _finalizeTermination();
      });
      return;
    }
    _finalizeTermination();
  }

  void _recordTerminationOutcome(Map<String, dynamic> payload) {
    terminationReason = payload['reason']?.toString();
    feedbackExpected = payload['feedbackExpected'] as bool?;
    if (payload['reason'] == 'RECOGNITION_RECOVERY_LIMIT') {
      errorMessage =
          'Speech recognition returned only fragments repeatedly. '
          'The received text is saved; please restart when recognition is working.';
    }
    if (feedbackExpected == false) {
      errorMessage =
          '${errorMessage ?? ''} No interview answer was accepted. '
          'Received text is saved in History; no feedback will be generated.';
    }
  }

  void _finalizeTermination() {
    _terminationTimer?.cancel();
    _pendingTermination = false;
    isSessionEnded = true;
    _currentPhase = InterviewPhase.ready;
    _cleanup();
    _safeNotify();
  }

  void _handleTurnError(Map<String, dynamic> payload) {
    if (_resolvedRequests.contains(payload['requestId'])) return;
    if (payload['turnIndex'] is int &&
        (payload['turnIndex'] as int) < _lastTurnIndex) {
      return;
    }
    if (payload['clientTurnId'] != null &&
        payload['clientTurnId'] != _pendingAnswer?['clientTurnId']) {
      return;
    }
    if (payload['turnId'] != null && payload['turnId'] != _currentTurnId) {
      return;
    }
    if (payload['requestId'] != null &&
        _requestId != null &&
        payload['requestId'] != _requestId) {
      return;
    }
    errorMessage = payload['message'] ?? payload['error'] ?? 'Unknown error';
    if (payload['terminal'] == true ||
        payload['retryable'] == false ||
        [400, 403, 404, 422].contains(payload['code']) ||
        [
          'TURN_RECOVERY_EXHAUSTED',
          'RECOVERY_EXHAUSTED',
          'SESSION_TERMINAL',
          'ACCOUNT_DELETING',
        ].contains(payload['category'] ?? payload['code'])) {
      _stopRecovery(
        '$errorMessage Your answer is kept. Please end the interview.',
      );
      return;
    }
    if (payload['code'] == 401) _refreshCredentials = true;
    _pauseCapture();
    _scheduleResponseRecovery();
  }

  // FE-BUG FIX (mic after end): when the user ends a session while the AI is
  // speaking, the pending audio-playback .then()/.catchError() callbacks fire
  // AFTER cleanup and call _startListening(), turning the mic back on. This
  // flag is set synchronously the moment ending begins and blocks every
  // listening entry point.
  bool _isEnding = false;

  void _pauseCapture() {
    isPreparingVoice = false;
    _captureFinalized = true;
    _captureClosing = false;
    _captureId++;
    _segmentId++;
    isListening = false;
    _restartTimer?.cancel();
    _restartingSegment = false;
    _safetyTimer?.cancel();
    _sttService.stop();
  }

  void _startListening({bool preserve = false}) {
    if (_isEnding ||
        isSessionEnded ||
        _suspended ||
        _recoveryStopped ||
        _currentPhase == InterviewPhase.reconnecting) {
      return;
    }
    if (!microphoneAvailable) {
      errorMessage =
          'Microphone access is unavailable. Enable microphone permission in device settings before starting an interview.';
      _currentPhase = InterviewPhase.error;
      _safeNotify();
      return;
    }
    if (!_captureFinalized) return;
    final capture = ++_captureId;
    _captureFinalized = false;
    _heardCaptureSpeech = preserve && partialTranscript.isNotEmpty;
    if (!preserve) {
      _segments = '';
      partialTranscript = '';
      finalTranscript = '';
    } else {
      _segments = partialTranscript;
      if (_segments.isNotEmpty) {
        errorMessage =
            'Your interrupted draft is kept. Continue after the words shown when the microphone is ready.';
      }
    }
    if (!preserve) _microphoneRetries = 0;
    isListening = false;
    _currentPhase = InterviewPhase.listening;
    final gen = _generation;
    if (sessionId != null && _currentTurnId != null) {
      _sttService.setQuestionContext(
        sessionId: sessionId!,
        turnId: _currentTurnId!,
      );
    }
    _sttService.configureCapture(
      identity: '${sessionId ?? 'local'}:$gen:${_currentTurnId ?? capture}',
      preserve: preserve,
      onActivity: (speech) {
        if (_isStale(gen) ||
            capture != _captureId ||
            _captureClosing ||
            _captureFinalized ||
            _suspended ||
            _isEnding) {
          return;
        }
        if (speech) _heardCaptureSpeech = true;
      },
      onEndpoint: () {
        if (_sttService.usesAudioEndpoint &&
            !_isStale(gen) &&
            capture == _captureId &&
            !_suspended &&
            !_isEnding) {
          _finalizeCapture(capture);
        }
      },
    );
    _listenSegment(capture);
    _safeNotify();
  }

  void _listenSegment(int capture) async {
    final gen = _generation;
    final segment = ++_segmentId;
    _segmentRecoveryRequested = false;
    bool valid() =>
        !_isStale(gen) &&
        capture == _captureId &&
        segment == _segmentId &&
        !_captureFinalized &&
        !_suspended &&
        !_isEnding;
    try {
      await _sttService
          .startListening(
            onPartial: (text) {
              if (valid()) _acceptSpeech(text, capture);
            },
            onFinal: (text) {
              if (!valid()) return;
              _acceptSpeech(text, capture);
              if (!_captureClosing && !_sttService.usesAudioEndpoint) {
                _completeCapture(capture, partialTranscript);
              }
            },
            onError: (error) {
              if (!valid()) return;
              if (_captureClosing) {
                // Flush owns the retry transition; retain its error instead of
                // ignoring it or racing a second capture against shutdown.
                _captureClosingFailure = error.errorMsg;
                return;
              }
              final failure = SpeechFailure.fromCode(error.errorMsg);
              if (failure?.terminal == true) {
                _pauseCapture();
                if (error.errorMsg.contains('permission')) {
                  microphoneAvailable = false;
                }
                errorMessage = failure!.message;
                _currentPhase = InterviewPhase.error;
                _safeNotify();
              } else if (error.errorMsg == 'error_no_match' ||
                  error.errorMsg == 'error_speech_timeout') {
                _recoverMicrophone(capture, gen);
              } else {
                _recoverMicrophone(capture, gen);
                if (failure != null && _currentPhase != InterviewPhase.error) {
                  errorMessage = failure.message;
                  _safeNotify();
                }
              }
            },
            onStatus: (status) {
              if (valid() && status == 'transcriptionRecovered') {
                _finalizeCapture(capture);
              }
              if (valid() && status == 'recordingClipped') {
                recordingNotice =
                    'The microphone recording is clipping. Try speaking farther from the microphone; this is a recording-quality issue.';
                _safeNotify();
              }
              if (valid() && status == 'recordingUnavailable') {
                recordingNotice =
                    'Recording is unavailable on this device. Your interview continues with transcript feedback; delivery measurements will be unavailable.';
                _safeNotify();
              }
              if (valid() &&
                  !_captureClosing &&
                  (status == 'starting' || status == 'listening')) {
                isListening = status == 'listening';
                isPreparingVoice = status == 'starting';
                _safeNotify();
              }
              if (valid() && !_captureClosing && status == 'done') {
                _recoverMicrophone(capture, gen);
              }
            },
          )
          .timeout(Duration(seconds: _sttService.usesAudioEndpoint ? 120 : 30));
      if (valid() && !_captureClosing) {
        isListening = _sttService.isListening;
        _safetyTimer?.cancel();
        if (!_sttService.usesAudioEndpoint) {
          _safetyTimer = Timer(silenceDuration, () {
            if (valid() && !_captureClosing) {
              _completeCapture(capture, partialTranscript);
            }
          });
        }
        _safeNotify();
      }
    } catch (_) {
      if (valid() && !_captureClosing) _recoverMicrophone(capture, gen);
    }
  }

  void _acceptSpeech(String text, int capture) {
    final combined = _sttService.usesAudioEndpoint
        ? text.trim()
        : [_segments, text.trim()].where((s) => s.isNotEmpty).join(' ');
    if (combined == partialTranscript) {
      return; // duplicate final/partial is not new speech
    }
    partialTranscript = combined;
    recoveryAttempt = 0;
    errorMessage = _sttService.hasUnconfirmedSpeech
        ? 'Please repeat the interrupted portion when the microphone is ready. Earlier confirmed phrases are kept.'
        : null;
    _safeNotify();
  }

  void _recoverMicrophone(int capture, int gen) {
    isListening = false;
    isPreparingVoice = false;
    if (_segmentRecoveryRequested) return;
    _segmentRecoveryRequested = true;
    _safetyTimer
        ?.cancel(); // Recovery must not submit during recognizer downtime.
    if (_microphoneRetries >= maxRecoveryAttempts) {
      _pauseCapture();
      _currentPhase = InterviewPhase.error;
      errorMessage =
          'Speech recognition stopped after 3 recovery attempts. Your draft is kept in this session. Please end the interview.';
      _safeNotify();
      return;
    }
    recoveryAttempt = ++_microphoneRetries;
    errorMessage =
        'Recovering microphone automatically ($recoveryAttempt/3)… Please repeat the interrupted portion when the microphone is ready. Your draft is kept.';
    _safeNotify();
    if (_restartingSegment) {
      // An error can follow notListening. Upgrade that pending restart to a
      // counted recovery instead of letting callback order bypass the budget.
      return;
    }
    _restartSegment(capture, gen, recovering: true);
  }

  void _restartSegment(int capture, int gen, {bool recovering = false}) async {
    if (_restartingSegment || _captureClosing) return;
    _restartingSegment = true;
    try {
      await _sttService.stopCapture().timeout(const Duration(seconds: 10));
    } catch (_) {
      if (_isStale(gen) ||
          capture != _captureId ||
          _captureFinalized ||
          _captureClosing) {
        return;
      }
      _restartingSegment = false;
      _segmentRecoveryRequested = false;
      _recoverMicrophone(capture, gen);
      return;
    }
    if (_isStale(gen) ||
        capture != _captureId ||
        _captureFinalized ||
        _captureClosing) {
      return;
    }
    _restartTimer?.cancel();
    // A recovery cycle continues after the visible interrupted draft.
    _restartTimer = Timer(
      Duration(
        milliseconds: (recovering || _segmentRecoveryRequested) ? 1000 : 150,
      ),
      () {
        if (_isStale(gen) ||
            capture != _captureId ||
            _captureFinalized ||
            _captureClosing) {
          return;
        }
        _segmentId++;
        _segments = partialTranscript;
        _restartingSegment = false;
        _listenSegment(capture);
      },
    );
  }

  Future<void> _finalizeCapture(int capture, {String? typedText}) async {
    if (capture != _captureId ||
        _captureFinalized ||
        _captureClosing ||
        _isEnding) {
      return;
    }
    _captureClosing =
        true; // exactly once; allow only this segment's final words
    _captureClosingFailure = null;
    _restartTimer?.cancel();
    _restartingSegment = false;
    isListening = false;
    _currentPhase = InterviewPhase.processing;
    errorMessage = 'Finishing your transcript…';
    _safeNotify();
    final gen = _generation;
    try {
      await _sttService.stopCaptureAndFlush().timeout(
        const Duration(seconds: 30),
      );
      if (_captureClosingFailure != null) {
        throw StateError(_captureClosingFailure!);
      }
    } catch (failure) {
      if (_isStale(gen) || capture != _captureId || _isEnding || _suspended) {
        return;
      }
      _captureClosing = false;
      _currentPhase = InterviewPhase.listening;
      final reason = _captureClosingFailure ?? failure.toString();
      if (reason.contains('permission')) {
        _pauseCapture();
        microphoneAvailable = false;
        errorMessage =
            'Microphone permission is denied. Enable it in device settings before starting an interview.';
        _currentPhase = InterviewPhase.error;
        _safeNotify();
      } else {
        // Same capture, question, accumulated finals and unfinished draft.
        // No answer is submitted and no question advances on this failure.
        _recoverMicrophone(capture, gen);
      }
      return;
    }
    if (_isStale(gen) || capture != _captureId || _isEnding) return;
    final text = (typedText ?? partialTranscript).trim();
    if (typedText == null &&
        _heardCaptureSpeech &&
        _sttService.heardSpeech &&
        text.isEmpty) {
      _stopRecovery(
        'Speech was detected but could not be transcribed. Your draft is kept here. Please end the interview.',
      );
      return;
    }
    if (text.length > 10000) {
      _stopRecovery(
        'Your answer exceeds the supported length. Your complete draft is retained here. Please end the interview.',
      );
      return;
    }
    _completeCapture(capture, text, recordAudio: typedText == null);
  }

  // Both capture paths converge on the same exactly-once answer contract.
  // VAD reaches this only after the worker has drained and finalized its audio.
  void _completeCapture(int capture, String text, {bool recordAudio = true}) {
    if (capture != _captureId || _captureFinalized || _isEnding || _suspended) {
      return;
    }
    if (text.length > 10000) {
      _stopRecovery(
        'Your answer exceeds the supported length. Your complete draft is retained here. Please end the interview.',
      );
      return;
    }
    _captureFinalized = true;
    _captureClosing = false;
    _safetyTimer?.cancel();
    _restartTimer?.cancel();
    _restartingSegment = false;
    isListening = false;
    recoveryAttempt = 0;
    errorMessage = null;
    _segmentId++;
    finalTranscript = text;
    _silenceStrikes = text.isEmpty ? _silenceStrikes + 1 : 0;
    _submitResponse(text, capture, audioExpected: false);
    _sttService.clearCapture();
  }

  @visibleForTesting
  void debugStartListening() => _startListening();
  @visibleForTesting
  void debugAttachSocket(WebSocketClient socket, String id) {
    sessionId = id;
    _wsClient = socket;
    _initWebSocket();
  }

  Future<void> doneSpeaking() {
    _sttService.confirmRecovery();
    return _finalizeCapture(_captureId);
  }

  Future<void> submitTypedAnswer(String text) async {
    if (text.trim().isEmpty || _isEnding || isSessionEnded) return;
    _sttService.confirmRecovery();
    if (_captureFinalized) {
      _captureId++;
      _captureFinalized = false;
    }
    await _finalizeCapture(_captureId, typedText: text);
  }

  void _submitResponse(String text, int capture, {bool audioExpected = false}) {
    errorMessage = null;
    _currentPhase = InterviewPhase.processing;
    transcript.add(
      TranscriptEntry(role: 'USER', text: text, timestamp: DateTime.now()),
    );
    _pendingAnswer = {
      'sessionId': sessionId,
      'textTranscript': text,
      'isSilence': text.isEmpty,
      if (_sttService.submissionMetadata case final metadata?)
        'stt': {...metadata, 'edited': text != partialTranscript.trim()},
      if (audioExpected) 'audioExpected': true,
      'clientTurnId':
          '${sessionId ?? 'local'}-$_generation-$capture-${DateTime.now().microsecondsSinceEpoch}',
      'voiceId': _selectedVoiceId,
      'engine': _selectedEngine,
      'voiceMode': _voiceMode,
      'turnId': _currentTurnId,
    };
    _answerAcknowledged = false;
    _sendPendingAnswer();
    _safeNotify();
  }

  Future<void> retryAnswer() async {
    errorMessage = null;
    if (_pendingAnswer != null) {
      _currentPhase = InterviewPhase.processing;
      _sendPendingAnswer();
    } else {
      await resumeSession();
    }
    _safeNotify();
  }

  Future<void> retryMicrophone() async {
    final gen = _generation;
    final available = await _sttService.init();
    if (_isStale(gen)) return;
    microphoneAvailable = available;
    if (microphoneAvailable) {
      errorMessage = null;
      _startListening(preserve: true);
    } else {
      errorMessage = 'Microphone access denied. You can type your answer.';
      _safeNotify();
    }
  }

  Future<void> resumeSession() async {
    final sid = sessionId;
    if (sid == null ||
        _isEnding ||
        _recoveryStopped ||
        _suspended ||
        _connectingTransport) {
      return;
    }
    final gen = _generation;
    final operation = ++_connectionEpoch;
    bool valid() =>
        !_isStale(gen) &&
        operation == _connectionEpoch &&
        !_isEnding &&
        !_suspended &&
        !_recoveryStopped &&
        sessionId == sid;
    _connectingTransport = true;
    _currentPhase = InterviewPhase.reconnecting;
    isConnecting = true;
    _safeNotify();
    try {
      final user = _auth.currentUser;
      if (user == null) {
        _stopRecovery('Please sign in again, then resume your interview.');
        return;
      }
      final token = await user
          .getIdToken(true)
          .timeout(const Duration(seconds: 10));
      if (!valid() || _auth.currentUser?.uid != user.uid) return;
      if (token == null || token.isEmpty) {
        _stopRecovery('Please sign in again, then resume your interview.');
        return;
      }
      if (_wsClient == null) {
        _wsClient = _wsFactory(
          url: ApiConstants.websocketUrl,
          userId: user.uid,
          sessionId: sid,
        );
        _initWebSocket();
      }
      if (_refreshCredentials || _transportLost) _wsClient!.disconnect();
      await _wsClient!.connect(authToken: token);
      if (!valid() || _auth.currentUser?.uid != user.uid) return;
      _transportLost = false;
      _refreshCredentials = false;
      _requestReconnect();
    } catch (error) {
      if (!valid()) return;
      if (error is FirebaseAuthException &&
          [
            'user-disabled',
            'user-token-expired',
            'invalid-user-token',
            'user-not-found',
            'invalid-credential',
          ].contains(error.code)) {
        _stopRecovery(
          'Your sign-in is no longer valid. Your draft is kept. Please sign in again.',
        );
        return;
      }
      errorMessage = 'Could not reconnect. Recovering automatically…';
      _scheduleResponseRecovery();
    } finally {
      if (!_isStale(gen) && operation == _connectionEpoch) {
        _connectingTransport = false;
      }
    }
  }

  /// Backgrounding must not turn OS microphone suspension into an empty answer.
  /// On return, ask the server for the authoritative turn before recording.
  void handleLifecycleState(AppLifecycleState state) {
    if (_isEnding || isSessionEnded) return;
    if ((state == AppLifecycleState.paused ||
            state == AppLifecycleState.inactive ||
            state == AppLifecycleState.hidden) &&
        !_suspended) {
      _suspended = true;
      _recoveryOperation++;
      _connectionEpoch++;
      _connectingTransport = false;
      _isInitializing = false;
      _pauseCapture();
      _cancelPlayback();
      _ttsService.stop().catchError((Object _) {});
      _responseTimer?.cancel();
      _recoveryTimer?.cancel();
      _currentPhase = InterviewPhase.reconnecting;
    } else if (state == AppLifecycleState.resumed && _suspended) {
      _suspended = false;
      if (sessionId == null && !_recoveryStopped && _initialRequest != null) {
        _scheduleResponseRecovery();
        return;
      }
      if (sessionId == null || _recoveryStopped) {
        _safeNotify();
        return;
      }
      isConnecting = true;
      errorMessage = 'Resuming your interview automatically…';
      if (_wsClient?.isConnected == true) {
        _requestReconnect();
      } else {
        resumeSession();
      }
    }
    _safeNotify();
  }

  void terminateSession() {
    _wsClient?.sendMessage({
      'type': 'terminate_session',
      'payload': {'sessionId': sessionId},
    });
  }

  /// Leaving the route abandons local work without fabricating completion.
  /// A later visit reconciles the still-owned backend session through 409.
  void leaveRoute() {
    _generation++;
    _connectingTransport = false;
    _transportLost = _refreshCredentials = false;
    _requestId = null;
    _initialRequest = null;
    _resolvedRequests.clear();
    _isEnding = true;
    isConnecting = false;
    _recoveredQuestion = null;
    _cleanup();
    // Completed sessions already notified before navigation. Route disposal
    // must not notify the departing widget tree while Flutter locks it.
    if (!isSessionEnded) _safeNotify();
  }

  // Additional methods for screen compatibility
  void resetForNewSession() {
    // R-09: a fresh session is a new generation, so any STT/TTS callback or
    // init still in flight from a previous session (incl. A->logout->A) is
    // invalidated and cannot bleed into this one.
    _generation++;
    _connectingTransport = false;
    _transportLost = _refreshCredentials = false;
    _requestId = null;
    _initialRequest = null;
    _resolvedRequests.clear();
    _cleanup();
    _isEnding = false;
    _suspended = false;
    _recoveryStopped = false;
    _currentTurnId = _recoveredQuestion = null;
    _audioRefreshable = false;
    _pendingTermination = false;
    _awaitingReconnect = false;
    _responseRetries = _microphoneRetries = recoveryAttempt = 0;
    _isInitializing = false;
    isSessionEnded = false;
    terminationReason = null;
    feedbackExpected = null;
    isConnecting = true;
    sessionId = null;
    subtitleText = "";
    isStreamingText = false;
    finalTranscript = "";
    partialTranscript = "";
    questionText = "";
    finalQuestionText = "";
    transcript.clear();
    _currentPhase = InterviewPhase.ready;
    _silenceStrikes = 0;
    _pendingAnswer = null;
    _answerAcknowledged = false;
    _completedTurns.clear();
    _streamSequences.clear();
    _lastTurnIndex = -1;
    errorMessage = null;
    recordingNotice = null;
    _safeNotify();
  }

  bool _isInitializing = false;

  /// Finding 7 (account isolation): tear the live interview down when the
  /// signed-in UID changes (sign-out or account switch). Cancels the
  /// WebSocket, STT and TTS immediately and clears all session state so no
  /// audio, socket, or transcript from the previous user survives. [_isEnding]
  /// is left set so any already-queued audio-playback callback cannot turn the
  /// mic back on; a legitimately started next session clears it via
  /// resetForNewSession().
  void resetForUser(String? uid) {
    _sttService.enableAnswerAudio(false);
    recordingNotice = null;
    _connectingTransport = false;
    _transportLost = _refreshCredentials = false;
    _requestId = null;
    _initialRequest = null;
    _resolvedRequests.clear();
    _pendingAnswer = null;
    _completedTurns.clear();
    _lastTurnIndex = -1;
    _generation++; // R-09: invalidate every in-flight init/STT/TTS continuation
    _isEnding = true; // block any pending _startListening() callbacks
    _pendingTermination = false;
    _cleanup(); // cancels ws subscription, stops STT/TTS, disconnects socket
    sessionId = null;
    moduleType = null;
    currentQuestion = null;
    audioUrl = null;
    transcript.clear();
    errorMessage = null;
    subtitleText = "";
    questionText = "...";
    finalQuestionText = "";
    partialTranscript = "";
    finalTranscript = "";
    isStreamingText = false;
    isConnecting = false;
    isListening = false;
    isSessionEnded = false;
    terminationReason = null;
    feedbackExpected = null;
    _isInitializing = false;
    _silenceStrikes = 0;
    _currentPhase = InterviewPhase.ready;
    _safeNotify();
  }

  Future<void> initSession(
    String type, {
    String? resumeId,
    String? websiteUrl,
    String? analysisId,
  }) async {
    if (_isInitializing) {
      debugPrint('Skipping duplicate initSession call');
      return;
    }
    _isInitializing = true;
    _initialRequest = {
      'type': type,
      'resumeId': resumeId,
      'websiteUrl': websiteUrl,
      'analysisId': analysisId,
    };

    // R-09: pin this multi-step init (STT init -> token -> REST init -> socket
    // connect -> session_init) to the identity/session that started it. If the
    // account switches (A->B) or logs out while any step is awaiting, the
    // continuation must not adopt a sessionId, open a socket, send session_init,
    // or write connecting/error state into the new account's provider.
    final int startGen = _generation;
    final connectionEpoch = ++_connectionEpoch;
    String? expectedUid;
    bool valid() =>
        !_isStale(startGen) &&
        connectionEpoch == _connectionEpoch &&
        !_suspended &&
        !_isEnding &&
        (expectedUid == null || _auth.currentUser?.uid == expectedUid);

    try {
      moduleType = type;
      isConnecting = true;
      _safeNotify();

      microphoneAvailable = await _sttService.init();
      if (!valid()) return;
      if (!microphoneAvailable) {
        errorMessage = _sttService.supportedPlatform
            ? 'Enable microphone permission and a speech recognition service in device settings before starting an interview.'
            : 'Hands-free audio capture currently requires Android 7 or later.';
        isConnecting = false;
        _currentPhase = InterviewPhase.error;
        _safeNotify();
        return;
      }

      // Get the current user's Firebase ID token
      final user = _auth.currentUser;
      expectedUid = user?.uid;
      final idToken = await user?.getIdToken().timeout(
        const Duration(seconds: 10),
      );
      if (!valid()) return;

      if (_auth.currentUser?.uid != user?.uid) return;
      if (user == null || idToken == null) {
        errorMessage = 'Authentication required. Please log in again.';
        isConnecting = false;
        _currentPhase = InterviewPhase.error;
        _safeNotify();
        return;
      }

      // Create a backend session before opening the websocket.
      try {
        final response = await DioClient().dio.post(
          ApiConstants.interviewInit,
          data: {
            'moduleType': moduleType,
            'voiceId': _selectedVoiceId,
            'engine': _selectedEngine,
            'voiceMode': _voiceMode,
            'resumeId': resumeId,
            'websiteUrl': websiteUrl,
            'analysisId': analysisId,
          },
        );

        // A switch/logout during the init request abandons the response for the
        // previous account rather than adopting its sessionId into B.
        if (!valid()) return;

        final sid = response.data['sessionId']?.toString();
        if (sid == null || sid.isEmpty) {
          throw Exception('Invalid sessionId returned from interview init');
        }
        sessionId = sid;

        _sttService.enableAnswerAudio(false);
      } catch (e) {
        if (!valid()) return;
        // BUG-9 FIX: Handle 409 concurrent session response
        if (e is DioException && e.response?.statusCode == 409) {
          final activeSessionId = e.response?.data['activeSessionId']
              ?.toString();
          if (activeSessionId != null && activeSessionId.isNotEmpty) {
            errorMessage = 'Resuming your active interview automatically…';
            // Store the activeSessionId for potential reconnection
            sessionId = activeSessionId;
            await resumeSession();
            return;
          }
        }
        if (!DioClient.isPermanentAuthenticationError(e) &&
            (e is! DioException ||
                e.response == null ||
                [429, 500, 502, 503, 504].contains(e.response?.statusCode))) {
          errorMessage =
              'Interview initialization interrupted. Recovering automatically…';
          _scheduleResponseRecovery();
          return;
        }
        errorMessage = DioClient.isPermanentAuthenticationError(e)
            ? 'Your login is no longer valid. Please sign in again.'
            : 'Could not initialize this interview. Please try again after resolving the account or usage limit.';
        isConnecting = false;
        _currentPhase = InterviewPhase.error;
        _safeNotify();
        return;
      }

      // Build the socket into a LOCAL var first so a stale teardown only ever
      // touches this flow's own socket, never one a legitimately-started next
      // session may already have installed.
      final ws = _wsFactory(
        url: ApiConstants.websocketUrl,
        userId: user.uid,
        sessionId: sessionId!,
      );
      _wsClient = ws;
      _initWebSocket();

      try {
        await ws
            .connect(authToken: idToken)
            .timeout(const Duration(seconds: 15));
        await ws.waitForConnection();
      } catch (e) {
        if (!valid()) {
          _teardownSocket(ws);
          return;
        }
        errorMessage = 'Connection interrupted. Recovering automatically…';
        isConnecting = true;
        _currentPhase = InterviewPhase.reconnecting;
        _scheduleResponseRecovery();
        _safeNotify();
        return;
      }

      // Last line of defence before the socket is used: if the account changed
      // during connect, tear this socket down instead of handing B a live
      // channel opened with A's credential.
      if (!valid()) {
        _teardownSocket(ws);
        return;
      }

      ws.sendMessage({
        'type': 'session_init',
        'payload': {
          'sessionId': sessionId,
          'moduleType': moduleType,
          'voiceId': _selectedVoiceId,
          'engine': _selectedEngine,
          'voiceMode': _voiceMode,
          'resumeId': resumeId,
          'websiteUrl': websiteUrl,
          'requestId': _requestId = '$_generation-init-${++_recoveryOperation}',
        },
      });
      _armResponseWatchdog();
      isConnecting = false;
      _safeNotify();
    } catch (error) {
      if (_isStale(startGen) || _suspended || _isEnding) return;
      if (_auth.currentUser == null ||
          (error is FirebaseAuthException &&
              [
                'user-disabled',
                'user-token-expired',
                'invalid-user-token',
                'user-not-found',
                'invalid-credential',
              ].contains(error.code))) {
        _stopRecovery('Your sign-in is no longer valid. Please sign in again.');
      } else {
        errorMessage =
            'Authentication or connection interrupted. Recovering automatically…';
        _scheduleResponseRecovery();
      }
    } finally {
      if (!_isStale(startGen) && connectionEpoch == _connectionEpoch) {
        _isInitializing = false;
      }
    }
  }

  /// Disconnects and forgets [ws] only if it is still this provider's active
  /// socket, so a stale init tearing down its own socket can never clobber the
  /// socket a legitimately-started next session has already installed.
  void _teardownSocket(WebSocketClient ws) {
    ws.disconnect();
    if (identical(_wsClient, ws)) {
      _wsSubscription?.cancel();
      _wsSubscription = null;
      _wsClient = null;
    }
  }

  // FE-BUG #1 FIX: endSession must NOT call resetForNewSession() after setting
  // isSessionEnded=true — resetForNewSession resets isSessionEnded to false,
  // which prevents the feedback screen navigation guard from ever firing.
  Future<void> endSession() async {
    if (isSessionEnded) return;
    final gen = _generation;
    final savedSessionId = sessionId;
    _isEnding = true;
    _recoveredQuestion = null;
    _cancelPlayback();
    _safeNotify();
    _pauseCapture();
    // A native plugin failure must not trap the user on the End control.
    try {
      await _sttService.stopCapture().timeout(const Duration(seconds: 5));
    } catch (_) {}
    if (_isStale(gen)) return;
    try {
      await _ttsService.stop().timeout(const Duration(seconds: 5));
    } catch (_) {}
    if (_isStale(gen)) return;
    _sttService.stop(); // and silence the mic immediately
    terminateSession();
    if (savedSessionId != null) {
      try {
        // BUG FIX: this posted to '/interview/init/<id>/terminate', a route the
        // API does not define — API Gateway answered 403 every time, so the
        // REST safety net behind the WebSocket terminate never actually ran.
        final response = await DioClient().dio.post(
          ApiConstants.interviewTerminate,
          data: {'sessionId': savedSessionId, 'reason': 'USER_INITIATED'},
        );
        if (!_isStale(gen)) {
          final data = response.data is String
              ? jsonDecode(response.data as String)
              : response.data;
          if (data is Map) {
            _recordTerminationOutcome(Map<String, dynamic>.from(data));
          }
        }
      } catch (e) {
        debugPrint('REST terminate failed: $e');
      }
    }
    await Future.delayed(const Duration(milliseconds: 300));
    if (_isStale(gen)) return;
    _cleanupResources(); // Dispose services WITHOUT touching isSessionEnded
    isSessionEnded = true;
    sessionId = savedSessionId; // Preserve sessionId for feedback navigation
    _currentPhase = InterviewPhase.ready;
    _safeNotify();
  }

  /// Disposes all active services and WebSocket connections WITHOUT resetting
  /// session state flags. Used by endSession() to preserve isSessionEnded.
  void _cleanupResources() {
    _recoveryTimer?.cancel();
    _cancelSocketSubscriptions();
    _pauseCapture();
    _cancelPlayback();
    _terminationTimer?.cancel();
    _responseTimer?.cancel();
    _sttService.stop();
    _sttService.clearCapture();
    _ttsService.stop().catchError((Object _) {});
    _wsClient?.disconnect();
    _wsClient = null;
  }

  void _cleanup() {
    _recoveryTimer?.cancel();
    _cancelSocketSubscriptions();
    _pauseCapture();
    _cancelPlayback();
    _terminationTimer?.cancel();
    _responseTimer?.cancel();
    _sttService.stop();
    _sttService.clearCapture();
    _ttsService.stop().catchError((Object _) {});
    _wsClient?.disconnect();
    _wsClient = null;
  }

  @override
  void dispose() {
    _generation++;
    _isEnding = true;
    _cleanup();
    _ttsService.dispose();
    _sttService.dispose();
    super.dispose();
  }
}
