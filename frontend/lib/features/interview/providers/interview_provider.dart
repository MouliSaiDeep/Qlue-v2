import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/network/websocket_client.dart';
import '../../../shared/services/stt_service.dart';
import '../../../shared/services/tts_service.dart';

enum InterviewPhase { ready, speaking, listening, processing, error }

class TranscriptEntry {
  final String role;
  final String text;
  final DateTime timestamp;

  TranscriptEntry({required this.role, required this.text, required this.timestamp});
}

class InterviewProvider extends ChangeNotifier {
  InterviewPhase _currentPhase = InterviewPhase.ready;
  InterviewPhase get currentPhase => _currentPhase;

  String? sessionId;
  String? moduleType;
  String? currentQuestion;
  String? audioUrl;
  List<TranscriptEntry> transcript = [];
  String? errorMessage;
  String _selectedVoiceId = 'Tiffany';
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

  void setVoice(String voiceId, {String? engine, String voiceMode = 'cost_saver'}) {
    _selectedVoiceId = voiceId;
    _voiceMode = voiceMode;
    // Engine follows the mode unless explicitly overridden.
    _selectedEngine = engine ?? (voiceMode == 'premium' ? 'generative' : 'neural');
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
  bool isSessionEnded = false;
  int _silenceStrikes = 0;
  int get silenceStrikes => _silenceStrikes;
  int _sttRetryCount = 0;

  WebSocketClient? _wsClient;
  final SttService _sttService = SttService();
  final TtsService _ttsService = TtsService();

  StreamSubscription? _wsSubscription;

  InterviewProvider();

  void _initWebSocket() {
    if (_wsClient == null) return;
    _wsSubscription = _wsClient!.messages.listen(_handleWebSocketMessage);
    _wsClient!.errors.listen((error) {
      errorMessage = error;
      _safeNotify();
    });
    // FE-BUG #6 FIX: Only fire isSessionEnded on an unexpected disconnect.
    // Intentional disconnects (via _cleanupResources) call wsClient.disconnect() which
    // must NOT add to the disconnects stream — see websocket_client.dart fix.
    _wsClient!.disconnects.listen((_) {
      if (!isSessionEnded) {
        isSessionEnded = true;
        _currentPhase = InterviewPhase.ready;
        _safeNotify();
      }
    });
    // FE-BUG #20 FIX: Guard reconnect against already-ended sessions
    _wsClient!.reconnects.listen((_) {
      if (!isSessionEnded && sessionId != null) {
        _wsClient!.sendMessage({
          'type': 'session_reconnect',
          'payload': {'sessionId': sessionId}
        });
      }
    });
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
    switch (message['type']) {
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
        _handleTermination();
        break;
      case 'error':
        errorMessage = message['payload']['message'];
        _safeNotify();
        break;
    }
  }

  void _handleTextStream(Map<String, dynamic> payload) {
    if (_currentPhase != InterviewPhase.speaking) {
      _currentPhase = InterviewPhase.speaking;
    }
    isStreamingText = true;
    subtitleText = payload['fullText'] ?? subtitleText;
    questionText = subtitleText;
    _safeNotify();
  }

void _handleTurnComplete(Map<String, dynamic> payload) {
    isStreamingText = false;
    transcript.add(TranscriptEntry(role: 'AI', text: payload['questionText'], timestamp: DateTime.now()));
    currentQuestion = payload['questionText'];
    questionText = currentQuestion ?? "...";
    finalQuestionText = questionText;
    subtitleText = questionText;
    audioUrl = payload['audioUrl'];
    final audioData = payload['audioData'] as String?;
    _currentPhase = InterviewPhase.speaking;
    _safeNotify();

    if (audioUrl?.isNotEmpty == true) {
      _ttsService.playUrl(audioUrl!)
          .timeout(const Duration(seconds: 60), onTimeout: () {
        throw TimeoutException('Audio playback timed out');
      })
          .then((_) {
        _currentPhase = InterviewPhase.listening;
        _safeNotify();
        _startListening();
      })
          .catchError((error) {
        errorMessage = 'Audio playback failed: $error';
        _currentPhase = InterviewPhase.listening;
        debugPrint('TTS playback error: $error');
        _safeNotify();
        _startListening();
      });
    } else if (audioData != null && audioData.isNotEmpty) {
      _ttsService.playBase64(audioData)
          .timeout(const Duration(seconds: 60), onTimeout: () {
        throw TimeoutException('Audio playback timed out');
      })
          .then((_) {
        _currentPhase = InterviewPhase.listening;
        _safeNotify();
        _startListening();
      })
          .catchError((error) {
        // FE-BUG #14 FIX: audioData catch falls back to listening, not error state
        errorMessage = 'Audio playback failed: $error';
        _currentPhase = InterviewPhase.listening;
        debugPrint('TTS playback error: $error');
        _safeNotify();
        _startListening();
      });
    } else {
      // No audio available — still show question and allow user to respond
      debugPrint('No audio available for question, proceeding to listening phase');
      _currentPhase = InterviewPhase.listening;
      _safeNotify();
      _startListening();
    }
  }

  // GLITCH FIX (self-intro cutoff): the server sends 'termination' right
  // after the final turn's audio starts playing. Cleaning up immediately
  // stopped the player, so the closing message appeared as text but was
  // never spoken. If audio is playing, defer finalization until playback
  // completes (the playback .then always routes through _startListening,
  // which finalizes below); a 30s safety timer guarantees we never hang.
  bool _pendingTermination = false;

  void _handleTermination() {
    _isEnding = true;
    _sttService.stop();
    if (_currentPhase == InterviewPhase.speaking) {
      _pendingTermination = true;
      Future.delayed(const Duration(seconds: 30), () {
        if (_pendingTermination) _finalizeTermination();
      });
      return;
    }
    _finalizeTermination();
  }

  void _finalizeTermination() {
    _pendingTermination = false;
    isSessionEnded = true;
    _currentPhase = InterviewPhase.ready;
    _cleanup();
    _safeNotify();
  }

  void _handleTurnError(Map<String, dynamic> payload) {
    errorMessage = payload['message'] ?? payload['error'] ?? 'Unknown error';
    _currentPhase = InterviewPhase.error;
    _safeNotify();
  }

  Timer? _safetyTimer;
  
  // FE-BUG FIX (mic after end): when the user ends a session while the AI is
  // speaking, the pending audio-playback .then()/.catchError() callbacks fire
  // AFTER cleanup and call _startListening(), turning the mic back on. This
  // flag is set synchronously the moment ending begins and blocks every
  // listening entry point.
  bool _isEnding = false;

  void _startListening() {
    if (_isEnding || isSessionEnded) {
      debugPrint('STT: session ending/ended — refusing to start listening');
      if (_pendingTermination) _finalizeTermination(); // closing audio just finished
      return;
    }
    if (isListening && _sttService.isListening) return;
    
    // Cancel any pending safety timer from previous turn
    _safetyTimer?.cancel();
    
    isListening = true;
    _sttService.startListening(
      onPartial: (text) {
        partialTranscript = text;
        _safeNotify();
      },
      onFinal: (text) {
        finalTranscript = text;
        isListening = false;
        _sttRetryCount = 0; // Reset on success
        _safetyTimer?.cancel(); // Cancel safety timer on successful completion
        if (text.isEmpty) {
          _silenceStrikes++;
        } else {
          _silenceStrikes = 0;
        }
        _submitResponse(text);
        _safeNotify();
      },
      onError: (error) {
        debugPrint('Provider STT Error: ${error.errorMsg}');
        _handleSttFailure();
      },
      onStatus: (status) {
        if (status == 'done' && isListening) {
          // If native engine stopped but we haven't received a final result yet
          debugPrint('Provider STT status: done (still in listening phase)');
          _handleSttFailure();
        }
      },
    );

    // Safety timeout - force submit if onFinal never fires and retry logic fails
    _safetyTimer = Timer(const Duration(seconds: 40), () {
      if (isListening) {
        debugPrint('STT Absolute timeout: forcing submit');
        isListening = false;
        _submitResponse(partialTranscript);
        _safeNotify();
      }
    });
  }

  void _handleSttFailure() async {
    if (!isListening) return;

    if (_sttRetryCount < 2) {
      _sttRetryCount++;
      debugPrint('Retrying STT (Attempt $_sttRetryCount)...');
      
      // Briefly stop and wait before retrying to let engine clear
      _sttService.stop();
      await Future.delayed(const Duration(milliseconds: 500));
      
      // If first retry failed, try re-initializing
      if (_sttRetryCount == 2) {
        await _sttService.reInitialize();
      }
      
      _startListening();
    } else {
      debugPrint('STT failed after retries, submitting partial or empty response.');
      isListening = false;
      _sttRetryCount = 0;
      _submitResponse(partialTranscript);
      _safeNotify();
    }
  }

  void _submitResponse(String text) {
    isStreamingText = true;
    _currentPhase = InterviewPhase.processing;
    _safeNotify();

    transcript.add(TranscriptEntry(role: 'USER', text: text, timestamp: DateTime.now()));

    _wsClient?.sendMessage({
      'type': 'turn_submit',
      'payload': {
        'sessionId': sessionId,
        'textTranscript': text,
        'isSilence': text.isEmpty,
        'voiceId': _selectedVoiceId,
        'engine': _selectedEngine,
        'voiceMode': _voiceMode,
      },
    });
  }

  void terminateSession() {
    _wsClient?.sendMessage({
      'type': 'terminate_session',
      'payload': {
        'sessionId': sessionId,
      },
    });
  }

  // Additional methods for screen compatibility
  void resetForNewSession() {
    _cleanup();
    _isEnding = false;
    _isInitializing = false;
    isSessionEnded = false;
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
    errorMessage = null;
    _safeNotify();
  }

  bool _isInitializing = false;

  Future<void> initSession(String type, {String? resumeId, String? websiteUrl}) async {
    if (_isInitializing) {
      debugPrint('Skipping duplicate initSession call');
      return;
    }
    _isInitializing = true;
    
    try {
      moduleType = type;
      isConnecting = true;
      _safeNotify();

      await _sttService.init();
      // Get the current user's Firebase ID token
      final user = FirebaseAuth.instance.currentUser;
      final idToken = await user?.getIdToken();

    if (user == null || idToken == null) {
      errorMessage = 'Authentication required. Please log in again.';
      isConnecting = false;
      _safeNotify();
      return;
    }

    // Load voice preference from auth provider if not already set
    try {
      final authProvider = FirebaseAuth.instance.currentUser;
      if (authProvider != null) {
        // This would need to come from your auth/user model
        // For now, use default unless user has explicitly set it
      }
    } catch (e) {
      debugPrint('Could not load user voice preference: $e');
    }

    // Create a backend session before opening the websocket.
    try {
      final response = await DioClient().dio.post(ApiConstants.interviewInit, data: {
        'moduleType': moduleType,
        'voiceId': _selectedVoiceId,
        'engine': _selectedEngine,
        'voiceMode': _voiceMode,
        'resumeId': resumeId,
        'websiteUrl': websiteUrl,
      });

      sessionId = response.data['sessionId']?.toString();
      if (sessionId == null || sessionId!.isEmpty) {
        throw Exception('Invalid sessionId returned from interview init');
      }
    } catch (e) {
      // BUG-9 FIX: Handle 409 concurrent session response
      if (e is DioException && e.response?.statusCode == 409) {
        final activeSessionId = e.response?.data['activeSessionId']?.toString();
        if (activeSessionId != null && activeSessionId.isNotEmpty) {
          errorMessage = 'You have an active interview session. Reconnect to it?';
          // Store the activeSessionId for potential reconnection
          sessionId = activeSessionId;
          isConnecting = false;
          _safeNotify();
          return;
        }
      }
      errorMessage = 'Failed to initialize interview session: $e';
      isConnecting = false;
      _safeNotify();
      return;
    }

    _wsClient = WebSocketClient(
      url: ApiConstants.websocketUrl,
      userId: user.uid,
      sessionId: sessionId!,
    );
    _initWebSocket();

    try {
      await _wsClient!.connect(authToken: idToken);
      await _wsClient!.waitForConnection();
    } catch (e) {
      errorMessage = 'Failed to connect: $e';
      isConnecting = false;
      _safeNotify();
      return;
    }

    _wsClient!.sendMessage({
      'type': 'session_init',
      'payload': {
        'sessionId': sessionId,
        'moduleType': moduleType,
        'voiceId': _selectedVoiceId,
        'engine': _selectedEngine,
        'voiceMode': _voiceMode,
        'resumeId': resumeId,
        'websiteUrl': websiteUrl,
      },
    });
    isConnecting = false;
    _safeNotify();
    } finally {
      _isInitializing = false;
    }
  }

  // FE-BUG #1 FIX: endSession must NOT call resetForNewSession() after setting
  // isSessionEnded=true — resetForNewSession resets isSessionEnded to false,
  // which prevents the feedback screen navigation guard from ever firing.
  Future<void> endSession() async {
    if (isSessionEnded) return;
    _isEnding = true;          // block any pending _startListening callbacks
    _sttService.stop();        // and silence the mic immediately
    final savedSessionId = sessionId;
    terminateSession();
    if (savedSessionId != null) {
      try {
        // BUG FIX: this posted to '/interview/init/<id>/terminate', a route the
        // API does not define — API Gateway answered 403 every time, so the
        // REST safety net behind the WebSocket terminate never actually ran.
        await DioClient().dio.post(
          ApiConstants.interviewTerminate,
          data: {'sessionId': savedSessionId, 'reason': 'USER_INITIATED'},
        );
      } catch (e) {
        debugPrint('REST terminate failed: $e');
      }
    }
    await Future.delayed(const Duration(milliseconds: 300));
    _cleanupResources(); // Dispose services WITHOUT touching isSessionEnded
    isSessionEnded = true;
    sessionId = savedSessionId; // Preserve sessionId for feedback navigation
    _currentPhase = InterviewPhase.ready;
    _safeNotify();
  }

  /// Disposes all active services and WebSocket connections WITHOUT resetting
  /// session state flags. Used by endSession() to preserve isSessionEnded.
  void _cleanupResources() {
    _safetyTimer?.cancel();
    _wsSubscription?.cancel();
    _wsSubscription = null;
    _sttService.stop();
    _ttsService.stop();
    _wsClient?.disconnect();
    _wsClient = null;
  }

  void _cleanup() {
    _safetyTimer?.cancel();
    _wsSubscription?.cancel();
    _wsSubscription = null;
    _sttService.stop();
    _ttsService.stop();
    _wsClient?.disconnect();
    _wsClient = null;
  }

  @override
  void dispose() {
    _cleanup();
    super.dispose();
  }
}
