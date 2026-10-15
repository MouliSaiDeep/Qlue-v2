import 'dart:async';
import 'package:speech_to_text/speech_to_text.dart';

/// A small injectable boundary around the stable speech plugin, not a second
/// recognizer or native observer. Epochs fence late results after cancellation.
abstract class PlatformSpeechSource {
  void configureCapture(String identity) {}
  Future<bool> initialize();
  Stream<Map<String, dynamic>> get events;
  Future<void> start(int epoch);
  Future<void> stop(int epoch);
  Future<void> cancel(int epoch);
}

class AndroidSpeechSource implements PlatformSpeechSource {
  AndroidSpeechSource({SpeechToText? speech})
    : _speech = speech ?? SpeechToText();
  final SpeechToText _speech;
  final _events = StreamController<Map<String, dynamic>>.broadcast(sync: true);
  String _locale = 'en_IN';
  int? _epoch;

  void _emit(String type, {String? text}) {
    if (_epoch != null) {
      _events.add({'epoch': _epoch, 'type': type, 'text': text});
    }
  }

  @override
  void configureCapture(String identity) {}
  @override
  Future<bool> initialize() async {
    if (!await _speech.initialize(
      onError: (error) => _emit('error', text: error.errorMsg),
      onStatus: (status) => _emit(status == 'listening' ? 'ready' : status),
    )) {
      return false;
    }
    // initialize short-circuits after success on the plugin singleton.
    // Rebind the public listeners for the current session/account owner.
    _speech.errorListener = (error) => _emit('error', text: error.errorMsg);
    _speech.statusListener = (status) =>
        _emit(status == 'listening' ? 'ready' : status);
    try {
      final locale = (await _speech.systemLocale())?.localeId;
      if (locale != null && locale.toLowerCase().startsWith('en')) {
        _locale = locale;
      }
    } catch (_) {
      /* stable en_IN fallback */
    }
    return true;
  }

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;
  @override
  Future<void> start(int epoch) async {
    _epoch = epoch;
    await _speech.listen(
      onResult: (result) {
        if (_epoch != epoch) return;
        _emit(
          result.finalResult ? 'final' : 'partial',
          text: result.recognizedWords,
        );
      },
      listenOptions: SpeechListenOptions(
        listenFor: const Duration(seconds: 120),
        pauseFor: const Duration(seconds: 30),
        localeId: _locale,
        partialResults: true,
        listenMode: ListenMode.dictation,
      ),
    );
  }

  @override
  Future<void> stop(int epoch) async {
    if (_epoch == epoch) await _speech.stop();
  }

  @override
  Future<void> cancel(int epoch) async {
    if (_epoch != epoch) return;
    // Fence the old result closure before plugin cancellation emits callbacks.
    _epoch = null;
    try {
      await _speech.cancel();
    } catch (_) {
      _epoch ??= epoch; // Keep cancellation retryable.
      rethrow;
    }
  }
}
