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
  String _selectedEngine = 'generative';

  String get selectedVoiceId => _selectedVoiceId;
  String get selectedEngine => _selectedEngine;

  void setVoice(String voiceId, {String engine = 'generative'}) {
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
    _wsClient!.reconnects.listen((_) {
      if (sessionId != null) {
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
        errorMessage = 'Audio playback failed: $error';
        _currentPhase = InterviewPhase.error;
        debugPrint('TTS playback error: $error');
        _safeNotify();
      });
    } else {
      // No audio available — still show question and allow user to respond
      debugPrint('No audio available for question, proceeding to listening phase');
      _currentPhase = InterviewPhase.listening;
      _safeNotify();
      _startListening();
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

  Timer? _safetyTimer;
  
  void _startListening() {
    if (isListening) return;
    
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
        _safetyTimer?.cancel(); // Cancel safety timer on successful completion
        if (text.isEmpty) {
          _silenceStrikes++;
        } else {
          _silenceStrikes = 0;
        }
        _submitResponse(text);
        _safeNotify();
      },
    );

    // Safety timeout - force submit if onFinal never fires
    _safetyTimer = Timer(const Duration(seconds: 35), () {
      if (isListening && !_sttService.isListening) {
        // STT stopped without calling onFinal — force submit
        debugPrint('STT timeout: forcing submit after silence');
        isListening = false;
        _submitResponse('');
        _safeNotify();
      }
    });
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
        'resumeId': resumeId,
        'websiteUrl': websiteUrl,
      },
    });
    isConnecting = false;
    _safeNotify();
  }

  // frontend/lib/features/interview/providers/interview_provider.dart (Around Line 248)

  Future<void> endSession() async {
    if (isSessionEnded) return;
    final savedSessionId = sessionId;
    terminateSession();
    if(savedSessionId !=null){
      try{
        await DioClient().dio.post('${ApiConstants.interviewInit}/$savedSessionId/terminate');
      }
      catch(e){
        debugPrint("REST terminate failed: $e");
      }
    }
    await Future.delayed(const Duration(milliseconds: 300));
    isSessionEnded = true;
    resetForNewSession();
    sessionId = savedSessionId;

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
