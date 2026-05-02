import 'dart:async';
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
  List<String> transcript = [];
  String? errorMessage;
  String _selectedVoiceId = 'Tiffany';
  String _selectedEngine = 'neural';

  String get selectedVoiceId => _selectedVoiceId;
  String get selectedEngine => _selectedEngine;

  void setVoice(String voiceId, {String engine = 'neural'}) {
    _selectedVoiceId = voiceId;
    _selectedEngine = engine;
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
    _wsClient!.disconnects.listen((_) {
      isSessionEnded = true;
      _currentPhase = InterviewPhase.ready;
      _safeNotify();
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

  void _handleTurnComplete(Map<String, dynamic> payload) {
    currentQuestion = payload['questionText'];
    questionText = currentQuestion ?? "...";
    finalQuestionText = questionText;
    subtitleText = questionText;
    audioUrl = payload['audioUrl'];
    _currentPhase = InterviewPhase.speaking;
    _safeNotify();

    if (audioUrl != null) {
      _ttsService.playUrl(audioUrl!).then((_) {
        _currentPhase = InterviewPhase.listening;
        _safeNotify();
        _startListening();
      });
    }
  }

  void _handleTermination() {
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

  void _startListening() {
    isListening = true;
    _sttService.startListening(
      onPartial: (text) {
        partialTranscript = text;
        _safeNotify();
      },
      onFinal: (text) {
        finalTranscript = text;
        transcript.add(text);
        isListening = false;
        _submitResponse(text);
        _safeNotify();
      },
    );
  }

  void _submitResponse(String text) {
    _currentPhase = InterviewPhase.processing;
    _safeNotify();

    _wsClient?.sendMessage({
      'type': 'turn_submit',
      'payload': {
        'sessionId': sessionId,
        'textTranscript': text,
        'isSilence': false,
        'voiceId': _selectedVoiceId,
        'engine': _selectedEngine,
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

  Future<void> initSession(String type, {String? resumeId, String? websiteUrl}) async {
    moduleType = type;
    isConnecting = true;
    _safeNotify();

    // Get the current user's Firebase ID token
    final user = FirebaseAuth.instance.currentUser;
    final idToken = await user?.getIdToken();

    if (user == null || idToken == null) {
      errorMessage = 'Authentication required. Please log in again.';
      isConnecting = false;
      _safeNotify();
      return;
    }

    // Create a backend session before opening the websocket.
    try {
      final response = await DioClient().dio.post(ApiConstants.interviewInit, data: {
        'moduleType': moduleType,
        'voiceId': _selectedVoiceId,
        'engine': _selectedEngine,
        'resumeId': resumeId,
        'websiteUrl': websiteUrl,
      });

      sessionId = response.data['sessionId']?.toString();
      if (sessionId == null || sessionId!.isEmpty) {
        throw Exception('Invalid sessionId returned from interview init');
      }
    } catch (e) {
      errorMessage = 'Failed to initialize interview session: $e';
      isConnecting = false;
      _safeNotify();
      return;
    }

    _wsClient = WebSocketClient(
      url: 'wss://yofjsacuvf.execute-api.us-east-1.amazonaws.com/prod/',
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
        'resumeId': resumeId,
        'websiteUrl': websiteUrl,
      },
    });
    isConnecting = false;
    _safeNotify();
  }

  Future<void> endSession() async {
    if (isSessionEnded) return;

    terminateSession();

    isSessionEnded = true;
    _cleanup();

    _safeNotify();
  }

  void _cleanup() {
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
