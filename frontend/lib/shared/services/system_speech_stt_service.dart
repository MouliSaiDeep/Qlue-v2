import 'dart:async';
import 'answer_audio.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'platform_speech_source.dart';
import 'stt_service.dart';

/// Android's system recognizer supplies recognition and speech boundaries.
/// Supported answer recordings share its input stream through one microphone
/// producer. Text callbacks never measure silence.
class NativeSystemSpeechSource extends PlatformSpeechSource {
  NativeSystemSpeechSource({
    this.reviewFixture = const bool.fromEnvironment('SPEECH_REVIEW'),
  });
  final bool reviewFixture;
  bool audioEnabled = false, audioAvailable = false;
  Future<AnswerAudio?> takeAnswerAudio() async {
    audioAvailable = false;
    final data = await control.invokeMapMethod<String, dynamic>(
      'takeAnswerAudio',
    );
    return data == null
        ? null
        : AnswerAudio(
            data['path'] as String,
            data['fileSize'] as int,
            captureSegments: (data['captureSegments'] as List?)?.cast<int>(),
          );
  }

  void discardAnswerAudio() {
    audioAvailable = false;
    if (audioEnabled) {
      unawaited(
        control
            .invokeMethod<void>('discardAnswerAudio')
            .catchError((Object _) {}),
      );
    }
  }

  static const control = MethodChannel('qlue/platform_speech/control');
  static const channel = EventChannel('qlue/platform_speech/events');
  @override
  Future<bool> initialize() async {
    final allowed = await const MethodChannel(
      'qlue/interview_audio/control',
    ).invokeMethod<bool>('permission');
    return allowed == true &&
        await control.invokeMethod<bool>('available') == true;
  }

  @override
  Stream<Map<String, dynamic>> get events => channel
      .receiveBroadcastStream()
      .map((event) => Map<String, dynamic>.from(event as Map));
  @override
  Future<void> start(int epoch) =>
      control.invokeMethod<void>('start', {'epoch': epoch});
  @override
  Future<void> stop(int epoch) =>
      control.invokeMethod<void>('stop', {'epoch': epoch});
  @override
  Future<void> cancel(int epoch) =>
      control.invokeMethod<void>('cancel', {'epoch': epoch});

  Future<void> prepareCapture() async {
    if (audioEnabled && !reviewFixture) {
      try {
        audioAvailable =
            await control
                .invokeMethod<bool>('prepareAnswerAudio')
                .timeout(const Duration(seconds: 2)) ==
            true;
      } catch (_) {
        // Recording is optional. Failure must not consume speech recovery or
        // prevent the ordinary system recognizer from owning the microphone.
        audioAvailable = false;
        await control
            .invokeMethod<void>('discardAnswerAudio')
            .timeout(const Duration(milliseconds: 500))
            .catchError((Object _) {});
      }
    }
    if (reviewFixture && const bool.fromEnvironment('SPEECH_REVIEW')) {
      await control.invokeMethod<void>('prepareReviewFixture');
    }
  }
}

class SystemSpeechSttService extends SttService {
  SystemSpeechSttService({
    PlatformSpeechSource? source,
    Duration Function()? elapsed,
  }) : _native = source ?? NativeSystemSpeechSource(),
       _elapsed = elapsed;
  final PlatformSpeechSource _native;
  @override
  void enableAnswerAudio(bool enabled) {
    if (_native is NativeSystemSpeechSource) {
      if (!enabled) (_native).discardAnswerAudio();
      (_native).audioEnabled = enabled;
    }
  }

  @override
  bool get answerAudioAvailable =>
      _native is NativeSystemSpeechSource && (_native).audioAvailable;
  @override
  Future<AnswerAudio?> takeAnswerAudio() => _native is NativeSystemSpeechSource
      ? (_native).takeAnswerAudio()
      : Future.value(null);
  final Duration Function()? _elapsed;
  final Stopwatch _monotonic = Stopwatch()..start();
  Duration get _now => _elapsed?.call() ?? _monotonic.elapsed;
  StreamSubscription<Map<String, dynamic>>? _events;
  Future<void> _operations = Future.value();
  static int _nextEpoch = 0;
  int _epoch = 0, _owner = 0;
  int _preparedOwner = -1;
  bool _initialized = false, _disposed = false, _listening = false;
  bool _ready = false, _speaking = false, _closing = false, _ended = false;
  bool _restarting = false,
      _heard = false,
      _segmentFinal = false,
      _utteranceHeard = false;
  String? _identity;
  final List<String> _segments = [];
  String _draft = '';
  String _interrupted = '';
  Duration _quiet = Duration.zero;
  Duration _quietBeforeSpeech = Duration.zero;
  bool _heardBeforeSpeech = false;
  Duration? _quietSince;
  Timer? _endpointTimer, _readinessTimer;
  Completer<void>? _flush;
  Function(String)? _partial, _final, _status;
  Function(SpeechRecognitionError)? _error;
  void Function(bool)? _activity;
  void Function()? _endpoint;
  String get _text => [
    ..._segments,
    if (_interrupted.isNotEmpty) _interrupted,
    if (_draft.isNotEmpty) _draft,
  ].join(' ');
  @override
  bool get hasUnconfirmedSpeech => _interrupted.isNotEmpty;
  @override
  bool get usesAudioEndpoint => true;
  @override
  bool get stableTranscript => true;
  @override
  bool get heardSpeech => _heard;
  @override
  bool get isListening => _listening && _ready;

  @override
  void configureCapture({
    required String identity,
    required bool preserve,
    required void Function(bool) onActivity,
    required void Function() onEndpoint,
  }) {
    if (_identity != identity || !preserve) clearCapture();
    _identity = identity;
    _activity = onActivity;
    _endpoint = onEndpoint;
  }

  @override
  Future<bool> init({
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    if (onError != null) _error = onError;
    if (onStatus != null) _status = onStatus;
    if (_disposed) return false;
    if (!_initialized) {
      _initialized = await _native.initialize().timeout(
        const Duration(seconds: 15),
      );
    }
    _events ??= _native.events.listen(
      _event,
      onError: (Object _) => _fail('speech_service_interrupted'),
    );
    return _initialized;
  }

  void _freezeQuiet() {
    _endpointTimer?.cancel();
    if (_quietSince != null) _quiet += _now - _quietSince!;
    _quietSince = null;
  }

  void _armQuiet() {
    _freezeQuiet();
    if (!_listening || !_ready || _speaking || _closing || _ended) return;
    final limit = Duration(seconds: _heard ? 4 : 15);
    final remaining = limit - _quiet;
    _quietSince = _now;
    final owner = _owner, epoch = _epoch;
    _endpointTimer = Timer(
      remaining.isNegative ? Duration.zero : remaining,
      () {
        if (owner != _owner ||
            epoch != _epoch ||
            !_listening ||
            !_ready ||
            _speaking ||
            _closing ||
            _ended) {
          return;
        }
        _ended = true;
        _endpoint?.call();
      },
    );
  }

  void _event(Map<String, dynamic> event) {
    if (_disposed || !_listening || event['epoch'] != _epoch) return;
    // Review builds expose only boundary/error diagnostics, never recognized
    // words, account IDs, credentials or answer contents.
    if (const bool.fromEnvironment('SPEECH_REVIEW') &&
        const [
          'ready',
          'speechStart',
          'speechEnd',
          'final',
          'segmentFinal',
          'done',
          'error',
          'noMatch',
        ].contains(event['type'])) {
      debugPrint(
        'Qlue speech boundary=${event['type']} code=${event['code'] ?? '-'}',
      );
    }
    final text = (event['text'] as String? ?? '').trim();
    switch (event['type']) {
      case 'ready':
        _readinessTimer?.cancel();
        _ready = true;
        _status?.call('listening');
        _armQuiet();
        break;
      case 'speechStart':
        _freezeQuiet();
        _quietBeforeSpeech = _quiet;
        _heardBeforeSpeech = _heard;
        _quiet = Duration.zero;
        _speaking = true;
        _heard = true;
        _utteranceHeard = true;
        _activity?.call(true);
        break;
      case 'speechEnd':
        _speaking = false;
        _activity?.call(false);
        _quiet = Duration.zero;
        _armQuiet();
        break;
      case 'partial':
        if (_segmentFinal) return;
        _draft = text;
        _partial?.call(_text);
        break;
      case 'segmentFinal':
        if (text.isEmpty && (_draft.isNotEmpty || _utteranceHeard)) {
          _fail('speech_final_empty');
          return;
        }
        if (text.isNotEmpty) {
          _segments.add(text);
          _interrupted = '';
        }
        _draft = '';
        _utteranceHeard = false;
        _final?.call(_text);
        if (_closing && _flush?.isCompleted == false) _flush!.complete();
        break;
      case 'final':
        if (_segmentFinal) return;
        if (text.isEmpty && (_draft.isNotEmpty || _utteranceHeard)) {
          _fail('speech_final_empty');
          return;
        }
        _segmentFinal = true;
        if (text.isNotEmpty) {
          _segments.add(text);
          _interrupted = '';
        }
        _draft = '';
        _final?.call(_text);
        if (_closing) {
          if (_flush?.isCompleted == false) _flush!.complete();
        } else {
          _restart();
        }
        break;
      case 'done':
        if (_closing && _flush?.isCompleted == false) {
          _flush!.completeError(StateError('speech_final_missing'));
        } else if (!_closing) {
          _restart();
        }
        break;
      case 'error':
        final code = event['code'];
        if (code == 6 || code == 7) {
          _noMatch();
        } else {
          _fail(
            code == 9 ? 'microphone_permission' : 'speech_service_error_$code',
          );
        }
        break;
      case 'recordingUnavailable':
        if (_native is NativeSystemSpeechSource) {
          (_native).audioAvailable = false;
        }
        _status?.call('recordingUnavailable');
        break;
      case 'noMatch':
        _noMatch();
        break;
    }
  }

  void _noMatch() {
    // Native speech-start can be noise. Empty NO_MATCH/TIMEOUT is not a broken
    // microphone. A nonempty unfinished hypothesis still requires recovery.
    if (_draft.isNotEmpty) {
      _fail('speech_final_missing');
      return;
    }
    _freezeQuiet();
    if (_utteranceHeard) {
      _quiet += _quietBeforeSpeech;
      _heard = _heardBeforeSpeech;
    }
    _speaking = false;
    _utteranceHeard = false;
    _segmentFinal = true;
    _activity?.call(false);
    if (_closing) {
      if (_flush?.isCompleted == false) _flush!.complete();
    } else {
      _restart();
    }
  }

  Future<void> _begin(int owner) async {
    if (owner != _owner || _disposed || !_listening || _closing) return;
    final previous = _epoch;
    _epoch = ++_nextEpoch;
    final epoch = _epoch;
    await _native.cancel(previous).timeout(const Duration(seconds: 3));
    if (owner != _owner || epoch != _epoch || !_listening || _closing) return;
    _segmentFinal = false;
    _utteranceHeard = false;
    _speaking = false;
    _readinessTimer = Timer(const Duration(seconds: 5), () {
      if (owner == _owner && epoch == _epoch && !_ready) {
        _fail('speech_readiness_timeout');
      }
    });
    await _native.start(epoch).timeout(const Duration(seconds: 5));
  }

  void _restart() {
    if (_restarting || _closing || _ended) return;
    if (!_segmentFinal && _draft.isNotEmpty) {
      _fail('speech_final_missing');
      return;
    }
    _freezeQuiet();
    _ready = false;
    _restarting = true;
    _status?.call('starting');
    final owner = _owner;
    // Native service boundaries are normal segments, not microphone failures.
    final work = _operations.then((_) => _begin(owner));
    _operations = work.catchError((Object _) {});
    unawaited(
      work.then(
        (_) {
          if (owner == _owner) _restarting = false;
        },
        onError: (Object _) {
          if (owner == _owner) {
            _restarting = false;
            _fail('speech_restart_failed');
          }
        },
      ),
    );
  }

  void _fail(String reason) {
    if (const bool.fromEnvironment('SPEECH_REVIEW')) {
      debugPrint('Qlue speech failure=$reason');
    }
    _freezeQuiet();
    _readinessTimer?.cancel();
    _ready = false;
    if (_closing && _flush?.isCompleted == false) {
      _flush!.completeError(StateError(reason));
    } else if (_listening) {
      _error?.call(SpeechRecognitionError(reason, true));
    }
  }

  @override
  Future<void> startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    final owner = _owner;
    _partial = onPartial;
    _final = onFinal;
    _error = onError;
    _status = onStatus;
    if (!await init()) throw StateError('microphone_permission_or_service');
    if (_disposed || owner != _owner) return;
    if (_preparedOwner != owner && _native is NativeSystemSpeechSource) {
      await _native.prepareCapture().timeout(const Duration(seconds: 3));
      if (_disposed || owner != _owner) return;
      _preparedOwner = owner;
      if (_native.audioEnabled && !_native.audioAvailable) {
        _status?.call('recordingUnavailable');
      }
    }
    _listening = true;
    _closing = _ended = false;
    _quiet = Duration.zero;
    if (_text.isNotEmpty) _partial?.call(_text);
    final work = _operations.then((_) => _begin(owner));
    _operations = work.catchError((Object _) {});
    await work;
  }

  @override
  Future<void> stopCapture() async {
    _freezeQuiet();
    _readinessTimer?.cancel();
    _listening = _ready = _speaking = _restarting = false;
    final epoch = _epoch;
    _epoch = ++_nextEpoch;
    // Retain for display only. Recovery never confirms a partial hypothesis.
    if (_draft.isNotEmpty) _interrupted = _draft;
    _draft = '';
    final work = _operations.then(
      (_) => _native.cancel(epoch).timeout(const Duration(seconds: 3)),
    );
    _operations = work.catchError((Object _) {});
    await work;
  }

  @override
  Future<void> stopCaptureAndFlush() async {
    final owner = _owner;
    if (_interrupted.isNotEmpty && _draft.isEmpty) {
      throw StateError('speech_repeat_required');
    }
    _freezeQuiet();
    _readinessTimer?.cancel();
    // An answer may already consist of finalized utterances while Android is
    // listening again with no new speech. Stopping that idle listener produces
    // NO_MATCH/TIMEOUT (done), not a final result. Cancel it; there is no current
    // hypothesis to flush. The initial no-answer case uses the same rule.
    if (!_listening || _segmentFinal || (!_utteranceHeard && _draft.isEmpty)) {
      await stopCapture();
      return;
    }
    _closing = true;
    final flush = _flush = Completer<void>();
    flush.future.ignore();
    try {
      await _operations;
      if (owner != _owner) throw StateError('capture_cancelled');
      await _native.stop(_epoch).timeout(const Duration(seconds: 3));
      await flush.future.timeout(const Duration(seconds: 5));
      if (owner != _owner) throw StateError('capture_cancelled');
    } finally {
      if (owner == _owner) _closing = false;
    }
    await stopCapture();
  }

  @override
  void stop() {
    unawaited(stopCapture().catchError((Object _) {}));
  }

  @override
  void clearCapture() {
    if (_native is NativeSystemSpeechSource) (_native).discardAnswerAudio();
    _owner++;
    if (_flush?.isCompleted == false) {
      _flush!.completeError(StateError('capture_cancelled'));
    }
    stop();
    _segments.clear();
    _draft = '';
    _interrupted = '';
    _heard = _ended = _closing = _segmentFinal = false;
    _quiet = Duration.zero;
    _identity = null;
  }

  @override
  Future<void> reInitialize() async {
    await stopCapture();
    _initialized = false;
    if (!await init()) throw StateError('microphone_permission_or_service');
  }

  @override
  void dispose() {
    clearCapture();
    _disposed = true;
    unawaited(_events?.cancel());
    _events = null;
  }
}
