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
  bool _isCleanedUp = false;
  Timer? _watchdogTimer;
  Timer? _heartbeatTimer;


  void resetForNewSession() {
    isSessionEnded = false;
    isConnecting = true;
    _isCleanedUp = false;
    _isStartingListening = false;
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
    notifyListeners();
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

    notifyListeners();

    try {
      // Get voice from settings
      final prefs = await SharedPreferences.getInstance();
      final voiceId = prefs.getString('selected_voice') ?? 'Tiffany';
      final engine = prefs.getString('selected_engine') ?? 'generative';

      // FIX 1: Request microphone permission EARLY (before any audio)
      final sttReady = await _sttService.init();
      if (!sttReady) {
        errorMessage = "Microphone permission is required. Please enable it in app settings.";
        isConnecting = false;
        notifyListeners();
        return;
      }

      final response = await DioClient().dio.post(
        ApiConstants.interviewInit,
        data: {
          'moduleType': type,
          if (resumeId != null) 'resumeId': resumeId,
          if (websiteUrl != null) 'websiteUrl': websiteUrl,
          'voiceId': voiceId,
          'engine': engine,
          'force': true,
        },
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
      notifyListeners();
    }
  }

  Future<void> _connectWebSocket(String url, String token) async {
    await _wsClient.connect(url, token);
    _wsClient.onMessage.listen(_handleIncomingMessage);
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
    });
    isConnecting = false;

    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(minutes: 3), (timer) {
      _wsClient.send('ping', {});
    });

    notifyListeners();
  }

  void _handleIncomingMessage(Map<String, dynamic> msg) {
    final type = msg['type'];
    final payload = msg['payload'];

    switch (type) {
      case 'tts_audio_chunk':
        final base64Data = payload['audioData'] ?? '';
        final isLast = payload['isLast'] == true;
        final chunkIndex = payload['chunkIndex'] as int?;

        // CRITICAL: Always pass to TTS service, even when base64Data is empty.
        // The isLast flag with empty data signals "no more chunks coming" —
        // TTS service needs this to fire onPlaybackComplete after draining its queue.
        _ttsService.playBase64Chunk(base64Data, isLast, chunkIndex: chunkIndex);
        break;

      case 'ai_speaking_complete':
        // Only update subtitle text — do NOT start listening here.
        // Listening is triggered SOLELY by TTS onPlaybackComplete callback to avoid
        // the race condition where mic enables while AI audio is still playing.
        if (!isSessionEnded && currentPhase == InterviewPhase.speaking) {
          subtitleText = finalQuestionText.isNotEmpty ? finalQuestionText : questionText;
          isStreamingText = false;
          notifyListeners();
        }
        break;

      case 'session_text_stream':
        final streamText = payload?['text'] ?? msg['text'] ?? '';
        final status = payload?['status'] ?? '';
        
        if (status == 'thinking') {
          if (subtitleText.isEmpty) {
            subtitleText = "Thinking...";
          }
          isStreamingText = true;
          notifyListeners();
        } else if (streamText.isNotEmpty) {
          subtitleText = streamText;
          isStreamingText = true;
          notifyListeners();
        }
        break;

      case 'question_text_update':
        // Handle finalized question text from backend (no state transition)
        final questionUpdate = payload['questionText'];
        if (questionUpdate != null && questionUpdate != "...") {
          questionText = questionUpdate;
          finalQuestionText = questionUpdate;
          // Bug 5: Store current concept ID for website tutoring
          if (payload['currentConceptId'] != null) {
            currentConceptId = payload['currentConceptId'];
          }
          transcript.add(TranscriptEntry(
            role: 'ai',
            text: questionText,
            timestamp: DateTime.now(),
          ));
        }
        notifyListeners();
        break;

      case 'session_state_update':
        final newQuestion = payload['questionText'];
        if (newQuestion != null && newQuestion != "...") {
          questionText = newQuestion;
          finalQuestionText = newQuestion; // Store finalized question
        }

        final state = payload?['state'];
        _updatePhaseFromState(state);
        break;

      case 'termination':
        isSessionEnded = true;
        currentPhase = InterviewPhase.ready;
        _cleanup();
        notifyListeners();
        break;

      case 'error':
        errorMessage = payload['message'];
        isStreamingText = false;
        currentPhase = InterviewPhase.ready; // FIX: reset phase on error
        _watchdogTimer?.cancel();
        _ttsService.stop();
        notifyListeners();
        break;
    }
  }

  void _updatePhaseFromState(String? state) {
    if (state == null) return;
    switch (state) {
      case 'AI_SPEAKING':
        currentPhase = InterviewPhase.speaking;
        _stopListening();
        _ttsService.stop(); // FIX: Clear old audio to prevent overlap with new turn
        
        _watchdogTimer?.cancel();
        _watchdogTimer = Timer(const Duration(seconds: 25), () {
          debugPrint('Watchdog timer triggered: reconnecting session');
          _wsClient.send('session_reconnect', {'sessionId': sessionId});
        });
        break;
      case 'USER_RESPONDING':
        _watchdogTimer?.cancel();
        // FIX: Only set the phase — do NOT call _startListening() here.
        // The mic is enabled exclusively by TTS onPlaybackComplete callback.
        // This prevents double _startListening() and the mic-before-audio-finishes race.
        currentPhase = InterviewPhase.listening;
        
        // FIX 5: Only start listening if TTS is physically finished.
        // If TTS is still active, onPlaybackComplete will trigger it later.
        if (!_ttsService.isPlaying) {
          _startListening();
        }
        break;
      case 'PROCESSING_RESPONSE':
        _watchdogTimer?.cancel();
        currentPhase = InterviewPhase.processing;
        _stopListening();
        break;
      case 'SILENCE_DETECTED':
        _watchdogTimer?.cancel();
        currentPhase = InterviewPhase.processing;
        _stopListening();
        break;
    }
    notifyListeners();
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
      notifyListeners();
      _startListening();
    }
  }

  void sendTextTranscript(String text) {
    // FIX 2: Block if TTS is physically playing (race condition protection)
    if (currentPhase == InterviewPhase.speaking || currentPhase == InterviewPhase.processing || _ttsService.isPlaying || isSessionEnded) {
      debugPrint('Blocked transcript send: AI is speaking, processing, TTS is active, or session ended');
      return;
    }

    currentPhase = InterviewPhase.processing;
    _stopListening();
    
    transcript.add(TranscriptEntry(
      role: 'user',
      text: text,
      timestamp: DateTime.now(),
    ));
    finalTranscript = text;
    _wsClient.send('text_transcript', {
      'sessionId': sessionId,
      'text': text,
      if (currentConceptId != null) 'currentConceptId': currentConceptId, // Bug 5: Pass current concept
    });
    notifyListeners();
  }


  Future<void> endSession() async {
    _wsClient.send('terminate_session', {
      'sessionId': sessionId,
    });
    try {
      await DioClient().dio.post(ApiConstants.interviewTerminate, data: {'sessionId': sessionId});
    } catch (e) {}
    _cleanup();
    isSessionEnded = true;
    notifyListeners();
  }

  void _startListening() async {
    if (_isStartingListening) return;
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
             notifyListeners();
          }
        }
      };
      
      // FIX: Ensure STT is ready
      final ready = await _sttService.init();
      if (!ready) {
        errorMessage = "Microphone not available";
        isListening = false;
        notifyListeners();
        return;
      }
      
      _sttService.startListening(
        onPartial: (text) {
          if (currentPhase != InterviewPhase.listening) return;
          partialTranscript = text;
          _resetSilenceTimer();
          notifyListeners();
        },
        onFinal: (text) {
          // REMOVED: Phase guard to prevent dropping transcripts if state changed quickly
          partialTranscript = "";
          isListening = false;
          _stopSilenceTimer();
          sendTextTranscript(text);
          notifyListeners();
        },
      );
      notifyListeners();
    } finally {
      _isStartingListening = false;
    }
  }

  void _stopListening() {
    isListening = false;
    _sttService.stop();
    _stopSilenceTimer();
    notifyListeners();
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
    // Send silence event to backend so it can trigger retry/termination logic.
    // Backend owns the retry counting and session termination — frontend just reports.
    _wsClient.send('silence_detected', {
      'sessionId': sessionId,
      'silenceStrikes': _silenceStrikes,
    });
    _stopListening();
    // NOTE: Do NOT cleanup locally. Backend handles termination via handleSilenceDetected()
    // and sends a 'termination' message back if max strikes exceeded.
    notifyListeners();
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
    sessionId = null;
  }
}
