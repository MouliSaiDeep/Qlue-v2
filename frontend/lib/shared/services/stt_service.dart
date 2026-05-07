import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';

class SttService {
  final SpeechToText _speech = SpeechToText();
  bool _isInitialized = false;

  Future<bool> init() async {
    if (_isInitialized) return true;

    _isInitialized = await _speech.initialize(
      onError: (error) {
        print('STT Error: $error');
        // 🔴 FIX Bug #2: Log recoverable errors for debugging
        if (error.errorMsg == 'no_match' || error.errorMsg == 'busy') {
          print('STT: Recoverable error, continuing...');
        }
      },
      onStatus: (status) {
        print('STT Status: $status');
        // Status 'done' without onFinal means STT timed out
        if (status == 'done') {
          print('STT: Listening done (may have timed out)');
        }
      },
      cancelOnError: false, // 🔴 FIX: Keep listening even after errors
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
      listenFor: const Duration(seconds: 60),  // 🔴 FIX: Increased from 30s
      pauseFor: const Duration(seconds: 8),    // 🔴 FIX: Increased from 5s for thoughtful answers
      partialResults: true,
      localeId: 'en_US',
      listenMode: ListenMode.dictation,  // 🔴 FIX: Better for free-form speech
    );
  }

  void stop() {
    _speech.stop();
  }

  bool get isListening => _speech.isListening;
}
