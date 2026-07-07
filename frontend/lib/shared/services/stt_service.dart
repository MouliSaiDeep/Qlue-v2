import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_recognition_error.dart';

class SttService {
  final SpeechToText _speech = SpeechToText();
  bool _isInitialized = false;

  Function(SpeechRecognitionError)? _onError;
  Function(String)? _onStatus;

  Future<bool> init({Function(SpeechRecognitionError)? onError, Function(String)? onStatus}) async {
    if (_isInitialized) return true;
    _onError = onError;
    _onStatus = onStatus;

    _isInitialized = await _speech.initialize(
      onError: (error) {
        debugPrint('STT Global Error: $error');
        _onError?.call(error);
      },
      onStatus: (status) {
        debugPrint('STT Global Status: $status');
        _onStatus?.call(status);
      },
    );

    return _isInitialized;
  }

  Future<void> reInitialize() async {
    // BUG FIX: init() assigns _onError/_onStatus from its parameters, so
    // calling it bare wiped both callbacks to null on every re-init — after
    // the first STT recovery, error/status handling went silently dead.
    // Capture them first and pass them back through.
    final preservedOnError = _onError;
    final preservedOnStatus = _onStatus;
    _isInitialized = false;
    await _speech.stop();
    await init(onError: preservedOnError, onStatus: preservedOnStatus);
  }

  void startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) {
    if (!_isInitialized) {
      debugPrint('STT: Not initialized, attempting to start anyway...');
    }

    _onError = onError;
    _onStatus = onStatus;

    _speech.listen(
      onResult: (SpeechRecognitionResult result) {
        if (result.finalResult) {
          onFinal(result.recognizedWords);
        } else {
          onPartial(result.recognizedWords);
        }
      },
      listenFor: const Duration(seconds: 120),
      pauseFor: const Duration(seconds: 30), // FE-BUG #13 FIX: was 15s, too short for interview thinking time
      partialResults: true,
      localeId: 'en_US',
      listenMode: ListenMode.dictation,
    );
  }

  void stop() {
    _speech.stop();
  }

  bool get isListening => _speech.isListening;
}
