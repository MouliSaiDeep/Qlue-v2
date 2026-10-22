import 'dart:async';
import 'answer_audio.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'platform_speech_source.dart';

/// v1.0.8 recognition semantics with cancellation and question ownership.
/// Completion belongs to the plugin/provider, not a native/VAD endpoint timer.
class SttService {
  SttService({PlatformSpeechSource? source})
    : _source = source ?? AndroidSpeechSource();
  final PlatformSpeechSource _source;
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Future<void> _operations = Future.value();
  static int _nextEpoch = 0;
  int _epoch = 0;
  bool _initialized = false, _listening = false, _disposed = false;
  bool _heardSpeech = false;
  Function(String)? _partial, _final, _status;
  Function(SpeechRecognitionError)? _error;

  bool get isListening => _listening;
  bool get stableTranscript => true;
  bool get usesAudioEndpoint => false;
  bool get heardSpeech => _heardSpeech;
  bool get hasUnconfirmedSpeech => false;
  bool get requiresRecoveryConfirmation => false;
  void confirmRecovery() {}
  Map<String, dynamic>? get submissionMetadata => null;
  Map<String, dynamic> get diagnostics => const {};
  // Optional preparation only: never records audio or starts recognition.
  Future<void> prewarmQuestion({
    required String sessionId,
    required String turnId,
    required String identity,
  }) async {}
  void setQuestionContext({
    required String sessionId,
    required String turnId,
  }) {}
  bool get supportedPlatform => true;
  void enableAnswerAudio(bool enabled) {}
  bool get answerAudioAvailable => false;
  Future<AnswerAudio?> takeAnswerAudio() async => null;

  // Compatibility for retained recovery callers; deliberately no endpoint.
  void configureCapture({
    required String identity,
    required bool preserve,
    required void Function(bool) onActivity,
    required void Function() onEndpoint,
  }) {
    if (!preserve) clearCapture();
    _source.configureCapture(identity);
  }

  Future<bool> init({
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    if (onError != null) _error = onError;
    if (onStatus != null) _status = onStatus;
    if (_disposed) return false;
    if (!_initialized) {
      _initialized = await _source.initialize().timeout(
        const Duration(seconds: 15),
      );
    }
    _subscription ??= _source.events.listen(
      _event,
      onError: (Object _) {
        if (_listening) {
          _error?.call(
            SpeechRecognitionError('speech_service_interrupted', true),
          );
        }
      },
    );
    return _initialized;
  }

  void _event(Map<String, dynamic> event) {
    if (_disposed || !_listening || event['epoch'] != _epoch) return;
    final text = event['text'] as String? ?? '';
    switch (event['type']) {
      case 'partial':
        _heardSpeech |= text.isNotEmpty;
        _partial?.call(text);
        break;
      case 'final':
        _heardSpeech |= text.isNotEmpty;
        _listening = false;
        _final?.call(text);
        break;
      case 'ready':
        _status?.call('listening');
        break;
      case 'error':
        _error?.call(
          SpeechRecognitionError(
            text.isNotEmpty
                ? text
                : event['code'] == 9
                ? 'microphone_permission'
                : 'speech_service_interrupted',
            true,
          ),
        );
        break;
      case 'done':
      case 'notListening':
        _status?.call(event['type'] as String);
        break;
    }
  }

  Future<void> startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    final epoch = _epoch = ++_nextEpoch;
    _partial = onPartial;
    _final = onFinal;
    _error = onError;
    _status = onStatus;
    final work = _operations.then((_) async {
      if (_disposed || _epoch != epoch) return;
      if (!await init()) throw StateError('microphone_permission_or_service');
      if (_disposed || _epoch != epoch) return;
      _listening = true;
      await _source.start(epoch).timeout(const Duration(seconds: 5));
    });
    _operations = work.catchError((Object _) {});
    await work;
  }

  Future<void> stopCapture() async {
    final epoch = _epoch;
    _listening = false;
    final work = _operations.then(
      (_) => _source.cancel(epoch).timeout(const Duration(seconds: 3)),
    );
    _operations = work.catchError((Object _) {});
    await work;
  }

  // Kept for Replay/manual completion compatibility, without native-final waits.
  Future<void> stopCaptureAndFlush() => stopCapture();
  void stop() {
    unawaited(stopCapture().catchError((Object _) {}));
  }

  Future<void> reInitialize() async {
    await stopCapture();
    _initialized = false;
    if (!await init()) throw StateError('microphone_permission_or_service');
  }

  void clearCapture() {
    stop();
    _epoch = ++_nextEpoch;
    _heardSpeech = false;
    _partial = _final = _status = null;
    _error = null;
  }

  void dispose() {
    clearCapture();
    _disposed = true;
    unawaited(_subscription?.cancel());
    _subscription = null;
  }
}
