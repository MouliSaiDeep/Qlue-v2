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

  final List<List<int>> _audioChunkQueue = [];
  int _silenceStrikes = 0;
  Timer? _silenceTimer;

  final SttService _sttService = SttService();
  final TtsService _ttsService = TtsService();
  final WebSocketClient _wsClient = WebSocketClient();
  bool _isLastAudioChunkReceived = false;
  bool _isStartingListening = false;
  bool _isCleanedUp = false;


  Future<void> initSession(String type, {String? resumeId, String? websiteUrl}) async {
    isConnecting = true;
    isSessionEnded = false;
    _silenceStrikes = 0;
    errorMessage = null;
    assert(type == 'RESUME' || type == 'HR' || type == 'WEBSITE' || type == 'INTRO', 'Invalid moduleType');
    moduleType = type;
    _isLastAudioChunkReceived = false;
    subtitleText = "";
    isStreamingText = false;
    finalTranscript = "";
    notifyListeners();

    try {
      // Get voice from settings
      final prefs = await SharedPreferences.getInstance();
      final voiceId = prefs.getString('selected_voice') ?? 'Tiffany';
      final engine = prefs.getString('selected_engine') ?? 'generative';

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
    _ttsService.onPlaybackComplete = () async => await onAudioPlaybackComplete();
    _isLastAudioChunkReceived = false;
    startInterview();
  }


  void startInterview() {
    _wsClient.send('session_init', {
      'sessionId': sessionId,
      'moduleType': moduleType,
    });
    isConnecting = false;
    notifyListeners();
  }

  void _handleIncomingMessage(Map<String, dynamic> msg) {
    final type = msg['type'];
    final payload = msg['payload'];

    switch (type) {
      case 'tts_audio_chunk':
        final base64Data = payload['audioData'] ?? '';
        final isLast = payload['isLast'] == true;

        if (isLast) {
          _isLastAudioChunkReceived = true;
        }

        if (base64Data.isNotEmpty) {
          _ttsService.playBase64Chunk(base64Data, isLast);
        }

        // Transitioning is now handled by ai_speaking_complete
        break;

      case 'ai_speaking_complete':
        if (!isSessionEnded && currentPhase == InterviewPhase.speaking) {
          currentPhase = InterviewPhase.listening;
          subtitleText = finalQuestionText.isNotEmpty ? finalQuestionText : questionText;
          isStreamingText = false;
          notifyListeners();
          _startListening();
        }
        break;

      case 'session_text_stream':
        final streamText = payload?['text'] ?? msg['text'] ?? '';
        final status = payload?['status'] ?? '';
        
        if (status == 'thinking') {
          subtitleText = "Thinking...";
          isStreamingText = true;
          notifyListeners();
        } else if (streamText.isNotEmpty) {
          subtitleText = streamText;
          isStreamingText = true;
          notifyListeners();
        }
        break;

      case 'session_state_update':
        final newQuestion = payload['questionText'];
        if (newQuestion != null && newQuestion != "...") {
          questionText = newQuestion;
          finalQuestionText = newQuestion; // Store finalized question
          transcript.add(TranscriptEntry(
            role: 'ai',
            text: questionText,
            timestamp: DateTime.now(),
          ));
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
        isStreamingText = false; // FIX: reset streaming flag
        notifyListeners();
        break;
    }
  }

  void _updatePhaseFromState(String? state) {
    if (state == null) return;
    switch (state) {
      case 'AI_SPEAKING':
        currentPhase = InterviewPhase.speaking;
        break;
      case 'USER_RESPONDING':
        currentPhase = InterviewPhase.listening;
        _startListening();
        break;
      case 'PROCESSING_RESPONSE':
        currentPhase = InterviewPhase.processing;
        _stopListening();
        break;
      case 'SILENCE_DETECTED':
        _silenceStrikes++;
        if (_silenceStrikes >= AppConstants.maxSilenceStrikes) {
          isSessionEnded = true;
          _cleanup();
        }
        break;
    }
    notifyListeners();
  }

  Future<void> onAudioPlaybackComplete() async {
    if (!isSessionEnded && currentPhase == InterviewPhase.speaking) {
      currentPhase = InterviewPhase.listening;
      isStreamingText = false;
      subtitleText = finalQuestionText.isNotEmpty ? finalQuestionText : questionText;
      notifyListeners();
      _startListening();
    }
  }

  void sendTextTranscript(String text) {
    transcript.add(TranscriptEntry(
      role: 'user',
      text: text,
      timestamp: DateTime.now(),
    ));
    finalTranscript = text;
    _wsClient.send('text_transcript', {
      'sessionId': sessionId,
      'text': text,
    });
    notifyListeners();
  }

  List<List<int>> consumeAllAudioChunks() {
    final chunks = List<List<int>>.from(_audioChunkQueue);
    _audioChunkQueue.clear();
    return chunks;
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
      _resetSilenceTimer();
      
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
          if (currentPhase != InterviewPhase.listening) return;
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
    if (_silenceStrikes >= AppConstants.maxSilenceStrikes) {
      isSessionEnded = true;
      _cleanup();
    } else {
      // Potentially notify user of silence
    }
    notifyListeners();
  }

  void _cleanup() {
    if (_isCleanedUp) return;
    _isCleanedUp = true;
    _stopListening();
    _stopSilenceTimer();
    _wsClient.disconnect();
  }
}
