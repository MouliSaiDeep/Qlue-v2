import 'dart:async';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
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
  List<TranscriptEntry> transcript = [];
  String partialTranscript = "";
  
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


  Future<void> initSession(String type, {String? resumeId, String? websiteUrl}) async {
    isConnecting = true;
    isSessionEnded = false;
    _silenceStrikes = 0;
    errorMessage = null;
    moduleType = type;
    notifyListeners();

    try {
      final response = await DioClient().dio.post(
        ApiConstants.interviewInit,
        data: {
          'moduleType': type,
          if (resumeId != null) 'resumeId': resumeId,
          if (websiteUrl != null) 'websiteUrl': websiteUrl,
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
    _ttsService.onPlaybackComplete = onAudioPlaybackComplete;
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
        _ttsService.playBase64Chunk(base64Data, isLast);
        break;


      case 'session_state_update':
        questionText = payload['questionText'] ?? questionText;
        if (payload['questionText'] != null) {
          transcript.add(TranscriptEntry(
            role: 'ai',
            text: questionText,
            timestamp: DateTime.now(),
          ));
        }

        final state = payload['state'];
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
        notifyListeners();
        break;
    }
  }

  void _updatePhaseFromState(String state) {
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

  void onAudioPlaybackComplete() {
    _audioChunkQueue.clear();
    if (currentPhase == InterviewPhase.speaking) {
      // The backend might set us to listening via session_state_update, 
      // but if not, we transition manually or wait for the update.
      // Instructions say: onAudioPlaybackComplete() clears queue, transitions phase to listening
      currentPhase = InterviewPhase.listening;
      _startListening();
      notifyListeners();
    }
  }

  void sendTranscript(String text) {
    transcript.add(TranscriptEntry(
      role: 'user',
      text: text,
      timestamp: DateTime.now(),
    ));
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

  void _startListening() {
    isListening = true;
    _resetSilenceTimer();
    _sttService.startListening(
      onPartial: (text) {
        partialTranscript = text;
        _resetSilenceTimer();
        notifyListeners();
      },
      onFinal: (text) {
        partialTranscript = "";
        isListening = false;
        _stopSilenceTimer();
        sendTranscript(text);
        notifyListeners();
      },
    );
    notifyListeners();
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
    _stopListening();
    _stopSilenceTimer();
    _wsClient.disconnect();
  }
}
