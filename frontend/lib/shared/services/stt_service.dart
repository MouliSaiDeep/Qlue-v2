import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:flutter/foundation.dart';

class SttService {
  static final SttService _instance = SttService._internal();
  factory SttService() => _instance;
  SttService._internal();

  final SpeechToText _speech = SpeechToText();
  bool _isInitialized = false;
  bool _isInitializing = false;
  String _lastStatus = '';
  Function(String)? onStatusChange;

  Future<bool> init() async {
    if (_isInitialized) return true;
    if (_isInitializing) return false; // Prevent concurrent initialization
    
    _isInitializing = true;
    try {
      _isInitialized = await _speech.initialize(
        onError: (error) {
          debugPrint('STT Error: $error');
          if (onStatusChange != null) onStatusChange!('error');
        },
        onStatus: (status) {
          debugPrint('STT Status: $status');
          if (_lastStatus != status && onStatusChange != null) {
            _lastStatus = status;
            onStatusChange!(status);
          }
        },
        debugLogging: kDebugMode,
      );
      
      if (!_isInitialized) {
        debugPrint('STT: Initialization failed - speech recognition not available on this device');
      } else {
        debugPrint('STT: Initialization successful. Has permission: ${_speech.hasPermission}');
      }

      // Check available locales
      final locales = await _speech.locales();
      final hasEnUs = locales.any((l) => l.localeId == 'en_US');
      debugPrint('STT: en_US available: $hasEnUs');
    } catch (e) {
      debugPrint('STT: Initialization exception: $e');
      _isInitialized = false;
    } finally {
      _isInitializing = false;
    }
    return _isInitialized;
  }

  Future<void> startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
  }) async {
    if (!_isInitialized) {
      final success = await init();
      if (!success) {
        debugPrint('STT: Cannot start listening - not initialized');
        return;
      }
    }

    // Don't start if already listening — stop first
    if (_speech.isListening) {
      debugPrint('STT: Already listening, stopping first...');
      await _speech.stop();
    }
    
    try {
      await _speech.listen(
        onResult: (SpeechRecognitionResult result) {
          if (result.finalResult) {
            debugPrint('STT Final: "${result.recognizedWords}"');
            onFinal(result.recognizedWords);
          } else {
            debugPrint('STT Partial: "${result.recognizedWords}"');
            onPartial(result.recognizedWords);
          }
        },
        listenFor: const Duration(seconds: 60),
        pauseFor: const Duration(seconds: 3),
        partialResults: true,
        cancelOnError: true,
        listenMode: ListenMode.confirmation,
        localeId: 'en_US',
        onDevice: false,
      );
    } catch (e) {
      debugPrint('STT: Error starting to listen: $e');
    }
  }

  Future<void> stop() async {
    try {
      if (_speech.isListening) {
        await _speech.cancel();
      }
    } catch (e) {
      debugPrint('STT: Error stopping: $e');
    }
  }

  Future<void> cancel() async {
    try {
      if (_speech.isListening) {
        await _speech.cancel();
      }
    } catch (e) {
      debugPrint('STT: Error canceling: $e');
    }
  }

  bool get isListening => _speech.isListening;
  bool get isInitialized => _isInitialized;
  Future<bool> get hasPermission => _speech.hasPermission;
}
