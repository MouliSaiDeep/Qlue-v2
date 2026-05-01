import 'dart:async';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/network/websocket_client.dart';
import '../../../core/constants/api_constants.dart';
import '../../../core/constants/app_constants.dart';
import '../../../shared/services/stt_service.dart';
import '../../../shared/services/tts_service.dart';


enum InterviewPhase { ready, speaking, listening, processing }

class TranscriptEntry {
  final String role;
  final String text;
  final DateTime timestamp;

  TranscriptEntry({required this.role, required this.text, required this.timestamp});
}

class InterviewProvider extends ChangeNotifier {
  String? sessionId;
  String? moduleType;
  String? currentConceptId; // Bug 5: Track current concept for WEBSITE mode
  InterviewPhase currentPhase = InterviewPhase.ready;
  int currentTurnIndex = 0;
  
  String questionText = "...";
  String finalQuestionText = ""; // The finalized question shown after AI stops speaking
  // The streaming subtitle text (shown while AI is speaking)
  String subtitleText = "";
  // Whether we're currently streaming AI text
  bool isStreamingText = false;
  
  List<TranscriptEntry> transcript = [];
  String partialTranscript = "";
  String finalTranscript = ""; // Last finalized user transcript for display
  
  bool isConnecting = false;
  bool isListening = false;
  String? errorMessage;
  bool isSessionEnded = false;

  int _silenceStrikes = 0;
  int get silenceStrikes => _silenceStrikes;
  Timer? _silenceTimer;

  final SttService _sttService = SttService();
  final TtsService _ttsService = TtsService();
  final WebSocketClient _wsClient = WebSocketClient();
  bool _isStartingListening = false;
  bool _isTurnLocked = false; // NEW: half-duplex lock
  bool _isCleanedUp = false;
  Timer? _watchdogTimer;
  Timer? _heartbeatTimer;
  String _voiceId = 'Tiffany';
  String _engine = 'generative';

  /// Safe wrapper for notifyListeners that handles disposal errors
  void _safeNotify() {
    try {
      notifyListeners();
    } catch (e) {
      debugPrint('Provider notifyListeners failed (likely disposed): $e');
    }
  }


  void resetForNewSession() {
    isSessionEnded = false;
    isConnecting = true;
    _isCleanedUp = false;
    _isStartingListening = false;
    _isTurnLocked = false; // NEW
    sessionId = null;
    currentConceptId = null;
    subtitleText = "";
    isStreamingText = false;
    finalTranscript = "";
    partialTranscript = "";
    questionText = "";
    finalQuestionText = "";
    transcript.clear();
    currentPhase = InterviewPhase.ready;
    currentTurnIndex = 0;
    _silenceStrikes = 0;
    errorMessage = null;
    _wsClient.disconnect();
    _safeNotify();
  }


  Future<void> initSession(String type, {String? resumeId, String? websiteUrl}) async {
    // FULL RESET to prevent old session bleed
    _cleanup();
    _isCleanedUp = false;
    _isStartingListening = false;
    
    isConnecting = true;
    isSessionEnded = false;
    _silenceStrikes = 0;
    errorMessage = null;
    assert(type == 'RESUME' || type == 'HR' || type == 'WEBSITE' || type == 'INTRO', 'Invalid moduleType');
    moduleType = type;
    
    // RESET ALL TEXT
    subtitleText = "";
    isStreamingText = false;
    finalTranscript = "";
    partialTranscript = "";
    questionText = "";
    finalQuestionText = "";
    transcript.clear();
    currentConceptId = null;
    currentPhase = InterviewPhase.ready;
    currentTurnIndex = 0;

    _safeNotify();

    try {
      // Get voice from settings
      final prefs = await SharedPreferences.getInstance();
      _voiceId = prefs.getString('selected_voice') ?? 'Tiffany';
      _engine = prefs.getString('selected_engine') ?? 'generative';

      // FIX 1: Request microphone permission EARLY (before any audio)
      final sttReady = await _sttService.init();
      if (!sttReady) {
        errorMessage = "Microphone permission is required. Please enable it in app settings.";
        isConnecting = false;
        _safeNotify();
        return;
      }

      final initPayload = {
        'moduleType': type,
        'voiceId': _voiceId,
        'engine': _engine,
        'force': true,
      };
      if (resumeId != null) {
        initPayload['resumeId'] = resumeId;
      }
      if (websiteUrl != null) {
        initPayload['websiteUrl'] = websiteUrl;
      }

      final response = await DioClient().dio.post(
        ApiConstants.interviewInit,
        data: initPayload,
      );

      sessionId = response.data['sessionId'];
      // Use the wsUrl from the backend; fallback to .env WEBSOCKET_URL
      final wsUrl = response.data['wsUrl'] ?? ApiConstants.websocketUrl;

      // Get the real Firebase ID token for WebSocket authentication
      final firebaseUser = FirebaseAuth.instance.currentUser;
      final token = await firebaseUser?.getIdToken() ?? '';

      await _connectWebSocket(wsUrl, token);
    } catch (e) {
      errorMessage = "Failed to initialize session: ${e.toString()}";
      isConnecting = false;
      _safeNotify();
    }
  }

  StreamSubscription? _wsSubscription;
 
  Future<void> _connectWebSocket(String url, String token) async {
    await _wsClient.connect(url, token);
    
    // Cancel existing subscription to prevent duplicate processing
    await _wsSubscription?.cancel();
    _wsSubscription = _wsClient.onMessage.listen(_handleIncomingMessage);
 
    // Wire up TTS completion: when all audio finishes playing, transition to listening.
    // This is the SINGLE source of truth for enabling the mic — prevents race condition
    // where mic enables while AI audio is still playing through the speaker.
    _ttsService.onPlaybackComplete = () async => await onAudioPlaybackComplete();
    // Store sessionId on WebSocket client for reconnection
    _wsClient.setSessionId(sessionId);
    startInterview();
  }


  void startInterview() {
    _wsClient.send('session_init', {
      'sessionId': sessionId,
      'moduleType': moduleType,
      'voiceId': _voiceId,
      'engine': _engine,
    });
    isConnecting = false;
    _isTurnLocked = true; // LOCK: wait for first turn_complete

    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(minutes: 3), (timer) {
      _wsClient.send('ping', {});
    });

    _safeNotify();
  }

  void _handleIncomingMessage(Map<String, dynamic> msg) {
    final type = msg['type'];
    final payload = msg['payload'];

    switch (type) {
      case 'turn_complete':
        _isTurnLocked = false; // UNLOCK: server is ready for next turn
        _watchdogTimer?.cancel();

        final questionText = payload['questionText'] ?? '';
        final audioData = payload['audioData'] ?? '';
        final audioUrl = payload['audioUrl'] ?? '';

        subtitleText = questionText;
        finalQuestionText = questionText;
        isStreamingText = false;

        if (questionText.isNotEmpty && questionText != '...') {
          transcript.add(TranscriptEntry(
            role: 'ai',
            text: questionText,
            timestamp: DateTime.now(),
          ));
        }

        if (payload['currentConceptId'] != null) {
          currentConceptId = payload['currentConceptId'];
        }

        currentPhase = InterviewPhase.speaking;
        _safeNotify();

        if (audioUrl.isNotEmpty) {
          _ttsService.playUrl(audioUrl);
        } else if (audioData.isNotEmpty) {
          _ttsService.playBase64(audioData);
        } else {
          onAudioPlaybackComplete();
        }
        break;

      case 'turn_error':
        _isTurnLocked = false; // Unlock on error so user can retry
        _watchdogTimer?.cancel();
        errorMessage = payload['message'];
        currentPhase = InterviewPhase.ready;
        _safeNotify();
        break;

      case 'termination':
        isSessionEnded = true;
        currentPhase = InterviewPhase.ready;
        _cleanup();
        _safeNotify();
        break;
    }
  }

  Future<void> onAudioPlaybackComplete() async {
    _watchdogTimer?.cancel();
    // This is the SINGLE entry point for enabling the mic after AI finishes speaking.
    // It fires only after ALL TTS audio chunks have been played through the speaker.
    // Phase may be 'speaking' (normal) or 'listening' (if session_state_update arrived early).
    if (!isSessionEnded && (currentPhase == InterviewPhase.speaking || currentPhase == InterviewPhase.listening)) {
      currentPhase = InterviewPhase.listening;
      isStreamingText = false;
      subtitleText = finalQuestionText.isNotEmpty ? finalQuestionText : questionText;
      _safeNotify();
      _startListening();
    }
  }

  void sendTextTranscript(String text) {
    // HALF-DUPLEX GUARD: Cannot send while a turn is locked, AI is speaking, or session ended
    if (_isTurnLocked || currentPhase == InterviewPhase.speaking || isSessionEnded) {
      debugPrint('Blocked: turn locked, AI speaking, or session ended');
      return;
    }

    _isTurnLocked = true; // LOCK until turn_complete arrives
    currentPhase = InterviewPhase.processing;
    _stopListening();

    transcript.add(TranscriptEntry(
      role: 'user',
      text: text,
      timestamp: DateTime.now(),
    ));
    finalTranscript = text;

    _wsClient.send('turn_submit', {
      'sessionId': sessionId,
      'text': text,
      'voiceId': _voiceId,
      'engine': _engine,
      if (currentConceptId != null) 'currentConceptId': currentConceptId,
    });

    _watchdogTimer?.cancel();
    _watchdogTimer = Timer(const Duration(seconds: 60), () {
      if (_isTurnLocked) {
        _isTurnLocked = false;
        errorMessage = 'Response timed out. Please try again.';
        currentPhase = InterviewPhase.ready;
        _safeNotify();
      }
    });

    _safeNotify();
  }


  Future<void> endSession() async {
    if (isSessionEnded) return;
    
    _wsClient.send('terminate_session', {
      'sessionId': sessionId,
    });
    
    isSessionEnded = true;
    _cleanup();
    
    try {
      notifyListeners();
    } catch (e) {
      debugPrint('endSession notifyListeners failed (likely disposed): $e');
    }
  }

  void _startListening() async {
    if (_isStartingListening || _isTurnLocked || isSessionEnded) {
      _isStartingListening = false;
      return;
    }
    _isStartingListening = true;
    
    try {
      errorMessage = null; // Clear previous errors
      isListening = true;
      partialTranscript = "";
      finalTranscript = "";
      _resetSilenceTimer();
      
      _sttService.onStatusChange = (status) {
        if (status == 'done' || status == 'notListening') {
          if (isListening) {
             debugPrint('STT native stop detected. Syncing state...');
             isListening = false;
             _safeNotify();
          }
        }
      };
      
      // FIX: Ensure STT is ready
      final ready = await _sttService.init();
      if (!ready) {
        errorMessage = "Microphone not available";
        isListening = false;
        _safeNotify();
        return;
      }
      
      _sttService.startListening(
        onPartial: (text) {
          if (currentPhase != InterviewPhase.listening) return;
          partialTranscript = text;
          _resetSilenceTimer();
          _safeNotify();
        },
        onFinal: (text) {
          // REMOVED: Phase guard to prevent dropping transcripts if state changed quickly
          partialTranscript = "";
          isListening = false;
          _stopSilenceTimer();
          sendTextTranscript(text);
          _safeNotify();
        },
      );
      _safeNotify();
    } finally {
      _isStartingListening = false;
    }
  }

  void _stopListening() {
    isListening = false;
    _sttService.stop();
    _stopSilenceTimer();
    _safeNotify();
  }

  void _resetSilenceTimer() {
    _silenceTimer?.cancel();
    _silenceTimer = Timer(AppConstants.silenceTimeout, () {
      if (isListening) {
        _handleSilence();
      }
    });
  }

  void _stopSilenceTimer() {
    _silenceTimer?.cancel();
    _silenceTimer = null;
  }

  void _handleSilence() {
    _silenceStrikes++;
    if (_isTurnLocked) return; // Don't send if already processing

    _isTurnLocked = true;
    _stopListening();

    _wsClient.send('turn_submit', {
      'sessionId': sessionId,
      'text': '',
      'isSilence': true,
      'silenceStrikes': _silenceStrikes,
      'voiceId': _voiceId,
      'engine': _engine,
    });

    _watchdogTimer?.cancel();
    _watchdogTimer = Timer(const Duration(seconds: 30), () {
      if (_isTurnLocked) {
        _isTurnLocked = false;
        _startListening();
      }
    });

    _safeNotify();
  }

  void _cleanup() {
    if (_isCleanedUp) return;
    _isCleanedUp = true;
    _watchdogTimer?.cancel();
    _heartbeatTimer?.cancel();
    _stopListening();
    _ttsService.stop();
    _stopSilenceTimer();
    _wsClient.disconnect();
    _isTurnLocked = false;
    sessionId = null;
  }
}
