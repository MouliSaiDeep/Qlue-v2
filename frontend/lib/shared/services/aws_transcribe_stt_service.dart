import 'dart:async';
import 'dart:math';
import 'dart:typed_data';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:dio/dio.dart';
import '../../core/network/dio_client.dart';
import 'stt_service.dart';
import 'aws_pcm_source.dart';
import 'aws_transcript.dart';

typedef AudioTicketIssuer =
    Future<Map<String, dynamic>> Function(Map<String, dynamic> request);

class _PreparedAudioTicket {
  _PreparedAudioTicket(this.identity, this.captureId, this.epoch, this.ticket);
  final String identity, captureId;
  final int epoch;
  final Future<Map<String, dynamic>?> ticket;
}

class AwsTranscribeSttService extends SttService {
  AwsTranscribeSttService({
    AwsPcmSource? source,
    AudioTicketIssuer? issueTicket,
    AwsAudioTransport Function()? transportFactory,
    this.language = 'en-IN',
    this.stability = 'off',
    this.pause = const Duration(seconds: 4),
    this.automaticCompletion = true,
  }) : _source = source ?? NativeAwsPcmSource(),
       _issue = issueTicket ?? _ticket,
       _transportFactory = transportFactory ?? IsolateAwsAudioTransport.new;
  static Future<Map<String, dynamic>> _ticket(
    Map<String, dynamic> request,
  ) async => Map<String, dynamic>.from(
    (await DioClient().dio.post('/interview/stt-ticket', data: request)).data
        as Map,
  );
  final AwsPcmSource _source;
  final AudioTicketIssuer _issue;
  final AwsAudioTransport Function() _transportFactory;
  final String language, stability;
  final Duration pause;
  final bool automaticCompletion;
  Future<Map<String, dynamic>> _readyTicket(
    Map<String, dynamic> request,
    bool Function() active,
  ) async {
    final until = DateTime.now().add(const Duration(seconds: 100));
    while (active()) {
      try {
        return await _issue(request).timeout(const Duration(seconds: 12));
      } on DioException catch (error) {
        final data = error.response?.data;
        if (error.response?.statusCode != 503 ||
            data is! Map ||
            data['code'] != 'STT_GATEWAY_WARMING') {
          rethrow;
        }
        if (DateTime.now().isAfter(until)) {
          throw StateError('audio_startup_timeout');
        }
        _status?.call('starting');
        await Future<void>.delayed(const Duration(seconds: 3));
      }
    }
    throw StateError('audio_capture_cancelled');
  }

  static int _nextEpoch = 0;
  int _epoch = 0, _owner = 0, _sequence = 0, _offset = 0, _baseOffset = 0;
  int _capturedSamples = 0, _clippedSamples = 0;
  int _suppressedSamples = 0;
  bool _usedPreparedTicket = false;
  Map<String, dynamic> _audioProcessing = {};
  Stopwatch? _startupClock;
  double? _microphoneReadyMs;
  String? _lastFailure;
  double? _firstPartialMs;
  final List<double> _finalLagMs = [];
  final List<String> _interruptedDrafts = [];
  final Stopwatch _clock = Stopwatch()..start();
  final List<double> _reconnectGapsMs = [];
  double? _interruptedAtMs;
  bool _initialized = false,
      _disposed = false,
      _listening = false,
      _closing = false,
      _heard = false,
      _failed = false,
      _recovery = false,
      _confirmed = false;
  String? _sessionId, _turnId, _identity, _captureId;
  final List<AwsTranscript> _captures = [];
  final List<String> _streamIds = [];
  AwsTranscript? _current;
  bool _audioReady = false;
  Future<bool>? _initializing;
  _PreparedAudioTicket? _prepared;
  AwsAudioTransport? _transport;
  StreamSubscription<Map<String, dynamic>>? _pcmEvents, _networkEvents;
  Completer<void>? _flush, _stopped;
  Timer? _quiet;
  Function(String)? _partial, _final, _status;
  Function(SpeechRecognitionError)? _error;
  void Function(bool)? _activity;
  void Function()? _endpoint;
  @override
  bool get usesAudioEndpoint => true;
  @override
  Map<String, dynamic> get diagnostics => {
    'provider': 'aws-transcribe',
    'sampleRate': 16000,
    'capturedSamples': _capturedSamples,
    'clippedSamples': _clippedSamples,
    'noiseSuppressedSamples': _suppressedSamples,
    'audioProcessing': Map<String, dynamic>.from(_audioProcessing),
    'preparedTicketUsed': _usedPreparedTicket,
    'microphoneReadyMs': _microphoneReadyMs,
    'lastFailure': _lastFailure,
    'firstPartialMs': _firstPartialMs,
    'estimatedFinalLagMs': List<double>.from(_finalLagMs),
    'interruptedDrafts': List<String>.from(_interruptedDrafts),
    'interruptionToResumedAudioMs': List<double>.from(_reconnectGapsMs),
    'confidenceIsAccuracy': false,
  };
  @override
  bool get stableTranscript => true;
  @override
  bool get isListening => _listening && _audioReady && !_closing && !_failed;
  @override
  bool get heardSpeech => _heard;
  @override
  bool get hasUnconfirmedSpeech =>
      _recovery && !_confirmed || (_current?.provisional.isNotEmpty ?? false);
  @override
  bool get requiresRecoveryConfirmation => _recovery && !_confirmed;
  @override
  void confirmRecovery() {
    _confirmed = true;
  }

  @override
  Map<String, dynamic>? get submissionMetadata => _streamIds.isEmpty
      ? null
      : {
          'provider': 'aws-transcribe',
          'streamIds': List<String>.from(_streamIds),
          'confirmedRecovery': !_recovery || _confirmed,
        };
  String get _finalized =>
      _captures.map((c) => c.finalized).where((s) => s.isNotEmpty).join(' ');
  String get _display => [
    _captures
        .where((c) => c != _current)
        .map((c) => c.finalized)
        .where((s) => s.isNotEmpty)
        .join(' '),
    _current?.display ?? '',
  ].where((s) => s.isNotEmpty).join(' ');
  @override
  void setQuestionContext({required String sessionId, required String turnId}) {
    _sessionId = sessionId;
    _turnId = turnId;
  }

  @override
  void configureCapture({
    required String identity,
    required bool preserve,
    required void Function(bool) onActivity,
    required void Function() onEndpoint,
  }) {
    if (!preserve || _identity != identity) {
      final prepared = _prepared?.identity == identity ? _prepared : null;
      clearCapture();
      _prepared = prepared;
      _captureId = prepared?.captureId ?? _newCaptureId();
    }
    _identity = identity;
    _activity = onActivity;
    _endpoint = onEndpoint;
  }

  static String _newCaptureId() => List.generate(
    16,
    (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();

  @override
  Future<void> prewarmQuestion({
    required String sessionId,
    required String turnId,
    required String identity,
  }) async {
    if (_disposed || _listening || _recovery) return;
    if (_prepared?.identity == identity) return;
    final captureId = _newCaptureId(), epoch = ++_nextEpoch;
    final result = Completer<Map<String, dynamic>?>();
    final prepared = _prepared = _PreparedAudioTicket(
      identity,
      captureId,
      epoch,
      result.future,
    );
    try {
      if (!await init() || _disposed || !identical(_prepared, prepared)) {
        result.complete(null);
        return;
      }
      unawaited(_source.prepare().catchError((Object _) {}));
      // Tickets do not claim capacity or start a paid Transcribe stream.
      final ticket = await _issue({
        'sessionId': sessionId,
        'turnId': turnId,
        'captureId': captureId,
        'epoch': epoch,
        'language': language,
        'stability': stability,
      }).timeout(const Duration(seconds: 12));
      result.complete(ticket);
    } catch (_) {
      // Preparation is best effort. A normal owned start retries explicitly.
      result.complete(null);
    }
  }

  @override
  Future<bool> init({
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    if (_disposed) return false;
    _error = onError ?? _error;
    _status = onStatus ?? _status;
    if (!_initialized) {
      final initializing = _initializing ??= _source.initialize().timeout(
        const Duration(seconds: 15),
      );
      try {
        _initialized = await initializing;
        if (_initialized && !_disposed) {
          // Allocate the idle recorder/effects early, without startRecording.
          unawaited(_source.prepare().catchError((Object _) {}));
        }
      } finally {
        if (identical(_initializing, initializing)) _initializing = null;
      }
    }
    if (_disposed) return false;
    _pcmEvents ??= _source.events.listen(
      _pcm,
      onError: (Object _) => _fail('audio_capture_interrupted'),
    );
    return _initialized;
  }

  @override
  Future<void> startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    if (_listening && !_failed) throw StateError('capture_already_active');
    _startupClock = Stopwatch()..start();
    _partial = onPartial;
    _final = onFinal;
    _error = onError;
    _status = onStatus;
    final prepared = _prepared;
    _prepared = null;
    final owner = _owner, epoch = _epoch = prepared?.epoch ?? ++_nextEpoch;
    if (!await init()) {
      if (!_disposed && owner == _owner && epoch == _epoch) {
        _error?.call(
          SpeechRecognitionError('microphone_permission_or_service', true),
        );
      }
      throw StateError('microphone_permission_or_service');
    }
    if (_disposed || owner != _owner || epoch != _epoch) return;
    if (_sessionId == null || _turnId == null || _captureId == null) {
      throw StateError('missing_question_identity');
    }
    if (_streamIds.length >= 4) throw StateError('audio_recovery_limit');
    var ticket = await prepared?.ticket;
    if (_disposed || owner != _owner || epoch != _epoch) return;
    final expiry = ticket?['expiresAt'];
    if (expiry is num &&
        expiry <= DateTime.now().millisecondsSinceEpoch / 1000 + 5) {
      ticket = null;
    }
    _usedPreparedTicket = ticket != null;
    _status?.call('starting');
    try {
      ticket ??= await _readyTicket({
        'sessionId': _sessionId,
        'turnId': _turnId,
        'captureId': _captureId,
        'epoch': epoch,
        'language': language,
        'stability': stability,
        if (_streamIds.isNotEmpty) 'previousStreamId': _streamIds.last,
      }, () => !_disposed && owner == _owner && epoch == _epoch);
    } on DioException catch (failure) {
      final data = failure.response?.data;
      final code = data is Map ? data['code'] : null;
      if (!_disposed &&
          owner == _owner &&
          epoch == _epoch &&
          [
            'AWS_STT_DISABLED',
            'STREAM_DAILY_LIMIT',
            'STREAM_CAPACITY',
          ].contains(code)) {
        _error?.call(SpeechRecognitionError(code as String, true));
      }
      rethrow;
    }
    if (_disposed || owner != _owner || epoch != _epoch) return;
    final prior = ticket['priorEvidence'];
    if (prior is Map) {
      if (_current == null ||
          prior['streamId'] != _streamIds.last ||
          prior['captureId'] != _captureId) {
        throw StateError('invalid_resume_snapshot');
      }
      final draft = _current!.provisional;
      if (draft.isNotEmpty) _interruptedDrafts.add(draft);
      _current!.reconcileFinalSnapshot(
        prior['segments'] as List,
        prior['originalTranscript'] as String,
      );
      _final?.call(_finalized);
    }
    if (ticket['priorCompleted'] == true) {
      if (_current == null ||
          ticket['streamId'] != _streamIds.last ||
          ticket['captureId'] != _captureId) {
        throw StateError('invalid_final_snapshot');
      }
      _current!.reconcileFinalSnapshot(
        ticket['segments'] as List,
        ticket['originalTranscript'] as String,
      );
      _failed = false;
      _closing = false;
      _listening = false;
      // This snapshot was persisted after a normal end/drain, so its answer
      // boundary is already confirmed even if the completion frame was lost.
      _confirmed = true;
      _final?.call(_finalized);
      _status?.call('transcriptionRecovered');
      return;
    }
    if (ticket['captureId'] != _captureId ||
        ticket['epoch'] != epoch ||
        ticket['sampleRate'] != 16000 ||
        ticket['chunkBytes'] != 2560) {
      throw StateError('invalid_audio_ticket');
    }
    _current = AwsTranscript(
      streamId: ticket['streamId'] as String,
      epoch: epoch,
      captureId: _captureId!,
      sessionId: _sessionId!,
      turnId: _turnId!,
    );
    _captures.add(_current!);
    _streamIds.add(_current!.streamId);
    _offset = ticket['offsetSamples'] as int;
    _baseOffset = _offset;
    _sequence = 0;
    _audioReady = false;
    _failed = false;
    _closing = false;
    _stopped = Completer<void>();
    final transport = _transport = _transportFactory();
    _networkEvents = transport.events.listen(
      (e) {
        if (epoch == _epoch && owner == _owner && !_disposed) _network(e);
      },
      onError: (Object _) {
        if (epoch == _epoch && owner == _owner && !_disposed) {
          _fail('audio_disconnected');
        }
      },
    );
    try {
      await transport.connect(ticket);
      if (owner != _owner || epoch != _epoch || _disposed) {
        await transport.cancel();
        return;
      }
      _listening = true;
      _status?.call('starting');
      await _source.start(epoch).timeout(const Duration(seconds: 5));
    } catch (_) {
      if (owner == _owner && epoch == _epoch && !_disposed) {
        _fail('audio_start_failed');
      }
      rethrow;
    }
  }

  void _pcm(Map<String, dynamic> e) {
    if (_disposed || e['epoch'] != _epoch) return;
    if (e['type'] == 'stopped') {
      if (_stopped?.isCompleted == false) _stopped!.complete();
      return;
    }
    if (e['type'] == 'error') {
      _fail(e['code'].toString());
      return;
    }
    if (!_listening || _failed) return;
    if (e['type'] == 'ready') {
      _audioReady = true;
      _microphoneReadyMs = (_startupClock?.elapsedMicroseconds ?? 0) / 1000;
      _audioProcessing = {
        for (final key in ['echoCancellation', 'noiseSuppression', 'localVad'])
          if (e[key] is bool) key: e[key],
      };
      _status?.call('listening');
      return;
    }
    if (e['type'] != 'pcm') return;
    if (_interruptedAtMs != null) {
      _reconnectGapsMs.add(
        _clock.elapsedMicroseconds / 1000 - _interruptedAtMs!,
      );
      _interruptedAtMs = null;
    }
    final pcm = e['pcm'] as Uint8List;
    if (e['sampleRate'] != 16000 ||
        e['offsetSamples'] != _offset - _baseOffset ||
        e['sequence'] != _sequence ||
        pcm.isEmpty ||
        pcm.length > 2560 ||
        pcm.length.isOdd) {
      _fail('audio_gap_or_format');
      return;
    }
    final rms = (e['rms'] as num).toDouble();
    _capturedSamples += pcm.length ~/ 2;
    _clippedSamples += (e['clippedSamples'] as int? ?? 0);
    _suppressedSamples += (e['suppressedSamples'] as int? ?? 0);
    if (_capturedSamples > 16000 && _clippedSamples / _capturedSamples >= .01) {
      _status?.call('recordingClipped');
    }
    // Activity controls the hands-free pause timer; every sample is sent.
    final speech = e['speech'] as bool? ?? rms >= 0.012;
    if (speech) {
      _heard = true;
      _activity?.call(true);
      _quiet?.cancel();
    }
    _transport?.audio(pcm, _sequence++, _offset);
    _offset += pcm.length ~/ 2;
    if (!speech &&
        automaticCompletion &&
        !_closing &&
        !requiresRecoveryConfirmation &&
        _quiet == null) {
      _quiet = Timer(_heard ? pause : const Duration(seconds: 15), () {
        _quiet = null;
        if (isListening && !requiresRecoveryConfirmation) _endpoint?.call();
      });
    } else if (speech) {
      _quiet = null;
    }
  }

  void _network(Map<String, dynamic> e) {
    try {
      if (e['type'] == 'ack') {
        _source.ack(_epoch);
        return;
      }
      if (e['type'] == 'transcript') {
        final segment = AsrSegment.fromJson(e);
        if (_current?.accept(segment) != true) return;
        final elapsed = e['clientReceivedMsSinceFirstAudio'];
        if (elapsed is num && elapsed.isFinite) {
          if (segment.partial) _firstPartialMs ??= elapsed.toDouble();
          if (!segment.partial && segment.end != null) {
            _finalLagMs.add(elapsed.toDouble() - segment.end! * 1000);
          }
        }
        // ASR guesses from noise cannot turn into microphone activity.
        if (segment.partial) {
          _partial?.call(_display);
        } else {
          // Recovery waits for new finalized speech in the resumed stream.
          // Reconnecting, background noise or silence alone cannot submit an
          // interrupted draft. The user is prompted to repeat that portion.
          if (automaticCompletion &&
              _listening &&
              !_failed &&
              _recovery &&
              _streamIds.length > 1 &&
              segment.text.trim().isNotEmpty) {
            _confirmed = true;
          }
          _final?.call(_display);
        }
      } else if (e['type'] == 'complete') {
        if (e['streamId'] != _current?.streamId || e['epoch'] != _epoch) return;
        if (_current!.provisional.isNotEmpty ||
            e['originalTranscript'] != _current!.finalized) {
          _fail('speech_final_missing');
          return;
        }
        _final?.call(_finalized);
        if (_flush?.isCompleted == false) _flush!.complete();
      } else if (e['type'] == 'interrupted' || e['type'] == 'error') {
        _fail(
          e['reason']?.toString() ??
              e['code']?.toString() ??
              'speech_final_missing',
        );
      }
    } catch (_) {
      _fail('audio_protocol_error');
    }
  }

  void _fail(String reason) {
    if (_failed || _disposed) return;
    _failed = true;
    _lastFailure = reason;
    _interruptedAtMs ??= _clock.elapsedMicroseconds / 1000;
    _recovery = true;
    _confirmed = false;
    _quiet?.cancel();
    _quiet = null;
    if (_closing && _flush?.isCompleted == false) {
      _flush!.completeError(StateError(reason));
    } else if (_listening) {
      _error?.call(SpeechRecognitionError(reason, true));
    }
    // Stop both owners immediately: a stopped microphone must not leave a paid
    // upstream stream running while the user considers recovery.
    unawaited(stopCapture().catchError((Object _) {}));
  }

  @override
  Future<void> stopCaptureAndFlush() async {
    if (_failed) throw StateError('speech_repeat_required');
    if (!_listening) return;
    if (requiresRecoveryConfirmation) {
      throw StateError('speech_recovery_confirmation_required');
    }
    _closing = true;
    _quiet?.cancel();
    _quiet = null;
    _flush = Completer<void>();
    _flush!.future.ignore();
    final owner = _owner, epoch = _epoch;
    final flush = _flush!, stopped = _stopped!, transport = _transport;
    try {
      await _source.stop(epoch).timeout(const Duration(seconds: 3));
      await stopped.future.timeout(const Duration(seconds: 3));
      if (owner != _owner || epoch != _epoch || _disposed) {
        throw StateError('capture_cancelled');
      }
      transport?.end(_sequence, _offset);
      await flush.future.timeout(const Duration(seconds: 10));
      if (owner != _owner || epoch != _epoch || _disposed) {
        throw StateError('capture_cancelled');
      }
      _listening = false;
      _closing = false;
    } catch (_) {
      if (owner == _owner && epoch == _epoch && !_disposed) {
        _fail('speech_finalization_timeout');
      }
      rethrow;
    }
  }

  @override
  Future<void> stopCapture() async {
    // Fence a pending cold-start request as well as callbacks from a stopped
    // socket. A readiness response must never open the mic after cancellation.
    _owner++;
    final transport = _transport, subscription = _networkEvents, epoch = _epoch;
    _transport = null;
    _networkEvents = null;
    _quiet?.cancel();
    _quiet = null;
    if (_listening && !_closing) {
      _recovery = true;
      _confirmed = false;
    }
    _listening = false;
    _audioReady = false;
    try {
      await _source.stop(epoch).timeout(const Duration(seconds: 3));
    } finally {
      await transport?.cancel();
      await subscription?.cancel();
    }
  }

  @override
  void stop() {
    unawaited(stopCapture().catchError((Object _) {}));
  }

  @override
  void clearCapture() {
    _prepared = null;
    _owner++;
    if (_flush?.isCompleted == false) {
      _flush!.completeError(StateError('capture_cancelled'));
    }
    stop();
    _epoch = ++_nextEpoch;
    _captures.clear();
    _streamIds.clear();
    _current = null;
    _captureId = null;
    _heard = false;
    _recovery = false;
    _confirmed = false;
    _identity = null;
    _capturedSamples = 0;
    _clippedSamples = 0;
    _suppressedSamples = 0;
    _audioProcessing = {};
    _usedPreparedTicket = false;
    _microphoneReadyMs = null;
    _lastFailure = null;
    _firstPartialMs = null;
    _finalLagMs.clear();
    _interruptedDrafts.clear();
    _reconnectGapsMs.clear();
    _interruptedAtMs = null;
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
    unawaited(_pcmEvents?.cancel());
    _pcmEvents = null;
  }
}
