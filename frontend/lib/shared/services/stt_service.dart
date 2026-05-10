import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';

class SttService {
  final SpeechToText _speech = SpeechToText();
  bool _isInitialized = false;

  Future<bool> init() async {
    if (_isInitialized) return true;

    _isInitialized = await _speech.initialize(
      onError: (error) {
        debugPrint('STT Error: $error'); // FE-BUG #12 FIX: use debugPrint not print
        if (error.errorMsg == 'no_match' || error.errorMsg == 'busy') {
          debugPrint('STT: Recoverable error, continuing...');
        }
      },
      onStatus: (status) {
        debugPrint('STT Status: $status');
        if (status == 'done') {
          debugPrint('STT: Listening done (may have timed out)');
        }
      },
    );

    return _isInitialized;
  }

  void startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
  }) {
    if (!_isInitialized) return;

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
