import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:frontend/shared/services/aws_transcript.dart';
import 'package:frontend/shared/services/aws_pcm_source.dart';
import 'package:frontend/shared/services/aws_transcribe_stt_service.dart';
import 'package:frontend/shared/services/system_speech_stt_service.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/core/env.dart';
import 'interview_reconnect_contract_test.dart' as control;
import 'package:frontend/screens/interview/interview_recovery_controls.dart';

class Pcm extends AwsPcmSource {
  final bus = StreamController<Map<String, dynamic>>.broadcast(sync: true);
  int epoch = 0, starts = 0, stops = 0, acks = 0;
  int preparations = 0;
  bool permitted = true;
  Completer<void>? stopGate;
  @override
  Stream<Map<String, dynamic>> get events => bus.stream;
  @override
  Future<bool> initialize() async => permitted;
  @override
  Future<void> prepare() async {
    preparations++;
  }

  @override
  Future<void> start(int e) async {
    epoch = e;
    starts++;
    bus.add({'type': 'ready', 'epoch': e});
  }

  @override
  Future<void> stop(int e) async {
    stops++;
    bus.add({'type': 'stopped', 'epoch': e});
    await stopGate?.future;
  }

  @override
  void ack(int e) {
    acks++;
  }

  void chunk({
    int sequence = 0,
    int offset = 0,
    double rms = .1,
    int? atEpoch,
    bool? speech,
  }) => bus.add({
    'type': 'pcm',
    'epoch': atEpoch ?? epoch,
    'pcm': Uint8List(2560),
    'sequence': sequence,
    'offsetSamples': offset,
    'sampleRate': 16000,
    'rms': rms,
    'clippedSamples': 0,
    'speech': ?speech,
  });
}

class Transport extends AwsAudioTransport {
  final bus = StreamController<Map<String, dynamic>>.broadcast(sync: true);
  Map<String, dynamic>? ticket;
  final frames = <Map<String, int>>[];
  bool autoComplete = true, cancelled = false;
  @override
  Stream<Map<String, dynamic>> get events => bus.stream;
  @override
  Future<void> connect(Map<String, dynamic> t) async {
    ticket = t;
    bus.add({'type': 'ready'});
  }

  @override
  void audio(Uint8List pcm, int sequence, int offsetSamples) {
    frames.add({
      'sequence': sequence,
      'offset': offsetSamples,
      'bytes': pcm.length,
    });
    bus.add({'type': 'ack', 'sequence': sequence});
  }

  void segment(
    String id,
    String text, {
    bool partial = false,
    double? confidence = .9,
    bool? stable,
  }) => bus.add({
    'type': 'transcript',
    'provider': 'aws-transcribe',
    'language': 'en-IN',
    'streamId': ticket!['streamId'],
    'epoch': ticket!['epoch'],
    'captureId': ticket!['captureId'],
    'sessionId': ticket!['sessionId'],
    'turnId': ticket!['turnId'],
    'offsetSamples': ticket!['offsetSamples'],
    'resultId': id,
    'partial': partial,
    'text': text,
    'start': 0.0,
    'end': .5,
    'words': [
      {
        'text': text,
        'start': 0.0,
        'end': .5,
        'confidence': confidence,
        'stable': stable,
      },
    ],
  });
  @override
  void end(int frames, int nextOffsetSamples) {
    if (autoComplete) {
      bus.add({
        'type': 'complete',
        'streamId': ticket!['streamId'],
        'epoch': ticket!['epoch'],
        'originalTranscript': 'I I know',
        'nextOffsetSamples': nextOffsetSamples,
      });
    }
  }

  @override
  Future<void> cancel() async {
    cancelled = true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'cancelling during cold startup prevents retries and microphone activation',
    () async {
      final source = Pcm(), waiting = Completer<void>();
      var attempts = 0;
      final cold = AwsTranscribeSttService(
        source: source,
        issueTicket: (r) async {
          attempts++;
          if (!waiting.isCompleted) waiting.complete();
          throw DioException(
            requestOptions: RequestOptions(path: '/interview/stt-ticket'),
            response: Response(
              requestOptions: RequestOptions(path: '/interview/stt-ticket'),
              statusCode: 503,
              data: {'code': 'STT_GATEWAY_WARMING'},
            ),
          );
        },
      );
      cold.setQuestionContext(sessionId: 'session', turnId: 'question');
      cold.configureCapture(
        identity: 'session:question',
        preserve: false,
        onActivity: (_) {},
        onEndpoint: () {},
      );
      final pending = cold.startListening(onPartial: (_) {}, onFinal: (_) {});
      final cancelled = expectLater(pending, throwsStateError);
      try {
        await waiting.future;
        await cold.stopCapture();
        await cancelled;
        expect(attempts, 1);
        expect(source.starts, 0);
      } finally {
        cold.dispose();
      }
    },
  );
  test(
    'cold gateway retries without opening the microphone before it is ready',
    () async {
      final source = Pcm(), transport = Transport();
      var attempts = 0;
      final cold = AwsTranscribeSttService(
        source: source,
        transportFactory: () => transport,
        issueTicket: (r) async {
          if (++attempts == 1) {
            throw DioException(
              requestOptions: RequestOptions(path: '/interview/stt-ticket'),
              response: Response(
                requestOptions: RequestOptions(path: '/interview/stt-ticket'),
                statusCode: 503,
                data: {'code': 'STT_GATEWAY_WARMING'},
              ),
            );
          }
          expect(source.starts, 0);
          return {
            ...r,
            'streamId': 'a' * 32,
            'sampleRate': 16000,
            'chunkBytes': 2560,
            'offsetSamples': 0,
          };
        },
      );
      cold.setQuestionContext(sessionId: 'session', turnId: 'question');
      cold.configureCapture(
        identity: 'session:question',
        preserve: false,
        onActivity: (_) {},
        onEndpoint: () {},
      );
      try {
        await cold.startListening(onPartial: (_) {}, onFinal: (_) {});
        expect(attempts, 2);
        expect(source.starts, 1);
      } finally {
        cold.dispose();
      }
    },
  );
  late Pcm pcm;
  late AwsTranscribeSttService service;
  late List<Transport> transports;
  late List<String> partials, finals, errors;
  late int endpoints;
  Map<String, dynamic>? resumeEvidence;
  int issued = 0;
  setUp(() {
    pcm = Pcm();
    transports = [];
    partials = [];
    finals = [];
    errors = [];
    endpoints = 0;
    issued = 0;
    resumeEvidence = null;
    service = AwsTranscribeSttService(
      source: pcm,
      transportFactory: () {
        final t = Transport();
        transports.add(t);
        return t;
      },
      issueTicket: (r) async => {
        ...r,
        'gatewayUrl': 'wss://example.com/audio',
        'streamId': (++issued).toString().padLeft(32, '0'),
        'sampleRate': 16000,
        'chunkBytes': 2560,
        'offsetSamples': issued == 1 ? 0 : 1280,
        'priorEvidence': ?resumeEvidence,
      },
    );
    service.setQuestionContext(sessionId: 'session', turnId: 'question');
    service.configureCapture(
      identity: 'session:question',
      preserve: false,
      onActivity: (_) {},
      onEndpoint: () => endpoints++,
    );
  });
  tearDown(() {
    service.dispose();
  });
  Future<void> start() => service.startListening(
    onPartial: partials.add,
    onFinal: finals.add,
    onError: (e) => errors.add(e.errorMsg),
  );
  test('default rollout selects the existing recognizer', () {
    expect(Env.awsSttEnabled, false);
    final s = InterviewProvider.defaultSttService();
    expect(s, isA<SystemSpeechSttService>());
    s.dispose();
  });
  testWidgets(
    'hands-free AWS capture waits for TTS and four seconds of silence, with no Done button',
    (tester) async {
      final socket = control.Socket(),
          audio = control.Audio()..gate = Completer<void>();
      final provider = InterviewProvider(sttService: service, ttsService: audio)
        ..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      expect(pcm.starts, 0);
      expect(issued, 1, reason: 'Ticket warms while question audio plays');
      expect(
        transports,
        isEmpty,
        reason: 'Preparation starts no paid ASR stream',
      );
      expect(pcm.preparations, greaterThan(0));
      audio.gate!.complete();
      await tester.pump();
      await tester.pump();
      expect(pcm.starts, 1);
      final transport = transports.single;
      pcm.chunk();
      transport.segment('a', 'I I know');
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListenableBuilder(
              listenable: provider,
              builder: (_, _) => InterviewRecoveryControls(provider: provider),
            ),
          ),
        ),
      );
      expect(find.byKey(const Key('done-answering')), findsNothing);
      expect(find.text('Done answering'), findsNothing);
      expect(
        find.textContaining('4 seconds of silence submits it'),
        findsOneWidget,
      );
      pcm.chunk(sequence: 1, offset: 1280, rms: 0);
      await tester.pump(const Duration(milliseconds: 3999));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      final answers = socket.sent.where((m) => m['type'] == 'turn_submit');
      expect(answers, hasLength(1));
      expect(answers.single['payload'], containsPair('turnId', 'q0'));
      expect(answers.single['payload']['stt']['streamIds'], [
        transport.ticket!['streamId'],
      ]);
      transport.segment('late', 'late words');
      expect(answers, hasLength(1));
      provider.dispose();
      socket.dispose();
      await tester.pump();
    },
  );
  test(
    'result replacement, immutable finals, repeated words, zero and missing confidence',
    () async {
      await start();
      final t = transports.single;
      t.segment('a', 'I', partial: true);
      t.segment('a', 'I I know');
      t.segment('a', 'wrong', partial: true);
      expect(finals.last, 'I I know');
      expect(partials.last, 'I');
      final a = AwsTranscript(
        streamId: 's',
        epoch: 1,
        captureId: 'c',
        sessionId: 'session',
        turnId: 'question',
      );
      AsrSegment event(
        String stream,
        int epoch,
        String id,
        double? confidence,
      ) => AsrSegment.fromJson({
        'provider': 'aws-transcribe',
        'language': 'en-IN',
        'streamId': stream,
        'epoch': epoch,
        'captureId': 'c',
        'sessionId': 'session',
        'turnId': 'question',
        'offsetSamples': 0,
        'resultId': id,
        'partial': false,
        'text': 'word',
        'start': 0,
        'end': 1,
        'words': [
          {
            'text': 'word',
            'start': 0,
            'end': 1,
            'confidence': confidence,
            'stable': false,
          },
        ],
      });
      expect(a.accept(event('other', 1, 'bad', 1)), false);
      expect(a.accept(event('s', 2, 'bad', 1)), false);
      a.accept(event('s', 1, 'zero', 0));
      a.accept(event('s', 1, 'missing', null));
      expect(a.confidenceSummary()['mean'], 0);
      expect(a.confidenceSummary()['missing'], 1);
      expect(a.finalizedWords.first.stable, false);
      expect(
        () => a.reconcileFinalSnapshot([], 'missing final'),
        throwsStateError,
      );
      expect(a.finalized, 'word word');
    },
  );
  test(
    'PCM preserves silence and exact sample offsets with gateway acknowledgements',
    () async {
      await start();
      pcm.chunk(rms: 0);
      pcm.chunk(sequence: 1, offset: 1280, rms: 0);
      expect(transports.single.frames.map((e) => e['offset']), [0, 1280]);
      expect(pcm.acks, 2);
    },
  );
  test(
    'audio gaps fail visibly without silently dropping or renumbering samples',
    () async {
      await start();
      pcm.chunk(offset: 1280);
      expect(errors.single, contains('audio_gap'));
      expect(transports.single.frames, isEmpty);
    },
  );
  testWidgets('loud non-speech does not extend the answer pause', (
    tester,
  ) async {
    await start();
    pcm.chunk(speech: true);
    pcm.chunk(sequence: 1, offset: 1280, rms: .2, speech: false);
    await tester.pump(const Duration(seconds: 3));
    pcm.chunk(sequence: 2, offset: 2560, rms: .3, speech: false);
    await tester.pump(const Duration(seconds: 1));
    expect(endpoints, 1);
    expect(transports.single.frames.map((f) => f['offset']), [0, 1280, 2560]);
    expect(errors, isEmpty);
  });
  testWidgets('speech during a thinking pause resets automatic completion', (
    tester,
  ) async {
    await start();
    pcm.chunk(speech: true);
    pcm.chunk(sequence: 1, offset: 1280, speech: false);
    await tester.pump(const Duration(seconds: 3));
    pcm.chunk(sequence: 2, offset: 2560, speech: true);
    await tester.pump(const Duration(seconds: 2));
    expect(endpoints, 0);
    pcm.chunk(sequence: 3, offset: 3840, speech: false);
    await tester.pump(const Duration(seconds: 4));
    expect(endpoints, 1);
  });
  test('prepared tickets are reused only by their own question', () async {
    await service.prewarmQuestion(
      sessionId: 'session',
      turnId: 'question',
      identity: 'session:question',
    );
    expect(issued, 1);
    expect(pcm.starts, 0);
    expect(transports, isEmpty);
    service.configureCapture(
      identity: 'session:question',
      preserve: false,
      onActivity: (_) {},
      onEndpoint: () {},
    );
    await start();
    expect(issued, 1);
    expect(service.diagnostics['preparedTicketUsed'], true);
  });
  test('a new question discards the old prepared ticket', () async {
    await service.prewarmQuestion(
      sessionId: 'session',
      turnId: 'question',
      identity: 'session:question',
    );
    service.setQuestionContext(
      sessionId: 'session',
      turnId: 'another-question',
    );
    service.configureCapture(
      identity: 'session:another-question',
      preserve: false,
      onActivity: (_) {},
      onEndpoint: () {},
    );
    await start();
    expect(issued, 2);
    expect(transports.single.ticket!['turnId'], 'another-question');
    expect(service.diagnostics['preparedTicketUsed'], false);
  });
  test('permission failure never starts network or microphone', () async {
    pcm.permitted = false;
    await expectLater(start(), throwsStateError);
    expect(transports, isEmpty);
    expect(pcm.starts, 0);
  });
  testWidgets(
    'permission denial gives settings guidance without automatic microphone retries',
    (tester) async {
      pcm.permitted = false;
      final socket = control.Socket();
      final provider = InterviewProvider(
        sttService: service,
        ttsService: control.Audio(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));
      expect(provider.currentPhase, InterviewPhase.error);
      expect(provider.microphoneAvailable, false);
      expect(provider.errorMessage, contains('permission'));
      expect(pcm.starts, 0);
      expect(transports, isEmpty);
      provider.dispose();
      socket.dispose();
      await tester.pump();
    },
  );
  test(
    'a second start cannot create overlapping microphone or paid stream owners',
    () async {
      await start();
      await expectLater(start(), throwsStateError);
      expect(pcm.starts, 1);
      expect(transports, hasLength(1));
      expect(issued, 1);
    },
  );
  test(
    'an old network stream error cannot interrupt a new capture while old native stop drains',
    () async {
      await start();
      final old = transports.single;
      pcm.stopGate = Completer<void>();
      service.configureCapture(
        identity: 'new-capture',
        preserve: false,
        onActivity: (_) {},
        onEndpoint: () {},
      );
      await start();
      old.bus.addError(StateError('old socket failed'));
      expect(errors, isEmpty);
      expect(service.isListening, true);
      pcm.stopGate!.complete();
      await Future<void>.delayed(Duration.zero);
      expect(transports.last.cancelled, false);
    },
  );
  test(
    'capture failure closes the paid transport before waiting for recovery',
    () async {
      await start();
      final transport = transports.single;
      pcm.bus.add({
        'type': 'error',
        'epoch': pcm.epoch,
        'code': 'audio_backgrounded',
      });
      await Future<void>.delayed(Duration.zero);
      expect(transport.cancelled, true);
      expect(service.isListening, false);
      expect(service.requiresRecoveryConfirmation, true);
    },
  );
  testWidgets(
    'lost completion submits recovered server finals automatically without another microphone or socket',
    (tester) async {
      service.dispose();
      Map<String, dynamic>? initial;
      final t = Transport()..autoComplete = false;
      service = AwsTranscribeSttService(
        source: pcm,
        transportFactory: () => t,
        issueTicket: (r) async {
          if (initial != null) {
            return {
              'priorCompleted': true,
              'streamId': initial!['streamId'],
              'captureId': initial!['captureId'],
              'originalTranscript': 'recovered final',
              'segments': [
                {
                  ...initial!,
                  'provider': 'aws-transcribe',
                  'resultId': 'recovered',
                  'partial': false,
                  'text': 'recovered final',
                  'start': 0.0,
                  'end': .5,
                  'words': <dynamic>[],
                },
              ],
            };
          }
          return initial = {
            ...r,
            'streamId': 'a' * 32,
            'sampleRate': 16000,
            'chunkBytes': 2560,
            'offsetSamples': 0,
          };
        },
      );
      final socket = control.Socket();
      final provider = InterviewProvider(
        sttService: service,
        ttsService: control.Audio(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      pcm.chunk();
      t.segment('draft', 'unfinished', partial: true);
      pcm.chunk(sequence: 1, offset: 1280, rms: 0);
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      // The server persisted the drained final, but its completion frame was
      // lost. Ticket recovery below supplies that authoritative snapshot.
      t.bus.add({'type': 'error', 'code': 'audio_disconnected'});
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      await tester.pump();
      final answers = socket.sent.where((m) => m['type'] == 'turn_submit');
      expect(answers, hasLength(1));
      expect(answers.single['payload']['textTranscript'], 'recovered final');
      expect(answers.single['payload']['stt']['streamIds'], [
        initial!['streamId'],
      ]);
      expect(pcm.starts, 1);
      expect(service.isListening, false);
      expect(service.hasUnconfirmedSpeech, false);
      provider.dispose();
      socket.dispose();
      await tester.pump();
    },
  );
  test(
    'normal completion waits for authoritative final and does not mistake a segment for an answer',
    () async {
      await start();
      pcm.chunk();
      transports.single.segment('a', 'I I know');
      expect(endpoints, 0);
      await service.stopCaptureAndFlush();
      expect(finals.last, 'I I know');
      expect(service.submissionMetadata!['streamIds'], hasLength(1));
    },
  );
  test(
    'unfinished provisional text cannot be silently graded on completion',
    () async {
      await start();
      transports.single.segment('a', 'unfinished', partial: true);
      await expectLater(service.stopCaptureAndFlush(), throwsStateError);
      expect(service.hasUnconfirmedSpeech, true);
    },
  );
  testWidgets(
    'finalization timeout is bounded and leaves the answer recoverable',
    (tester) async {
      await start();
      transports.single.autoComplete = false;
      transports.single.segment('a', 'I I know');
      final pending = service.stopCaptureAndFlush();
      final expectation = expectLater(
        pending,
        throwsA(isA<TimeoutException>()),
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 11));
      await expectation;
      expect(service.requiresRecoveryConfirmation, true);
    },
  );
  testWidgets(
    'four-second pause respects resumed speech and does not clip audio',
    (tester) async {
      await start();
      pcm.chunk();
      pcm.chunk(sequence: 1, offset: 1280, rms: 0);
      await tester.pump(const Duration(milliseconds: 3500));
      expect(endpoints, 0);
      pcm.chunk(sequence: 2, offset: 2560);
      pcm.chunk(sequence: 3, offset: 3840, rms: 0);
      await tester.pump(const Duration(milliseconds: 3500));
      expect(endpoints, 0);
      await tester.pump(const Duration(milliseconds: 501));
      expect(endpoints, 1);
      expect(transports.single.frames, hasLength(4));
    },
  );
  testWidgets(
    'recovery waits for finalized resumed speech, then finishes hands-free after silence',
    (tester) async {
      await start();
      final old = transports.single;
      old.segment('a', 'earlier');
      pcm.bus.add({
        'type': 'error',
        'epoch': pcm.epoch,
        'code': 'audio_backgrounded',
      });
      await service.stopCapture();
      await start();
      expect(
        transports.last.ticket!['previousStreamId'],
        old.ticket!['streamId'],
      );
      expect(transports.last.ticket!['offsetSamples'], 1280);
      pcm.chunk();
      expect(transports.last.frames.single['offset'], 1280);
      expect(service.requiresRecoveryConfirmation, true);
      pcm.chunk(sequence: 1, offset: 1280, rms: 0);
      await tester.pump(const Duration(seconds: 5));
      expect(endpoints, 0);
      transports.last.segment('b', 'repeated portion', partial: true);
      expect(service.requiresRecoveryConfirmation, true);
      transports.last.segment('b', 'repeated portion');
      expect(service.requiresRecoveryConfirmation, false);
      pcm.chunk(sequence: 2, offset: 2560, rms: 0);
      await tester.pump(const Duration(milliseconds: 3999));
      expect(endpoints, 0);
      await tester.pump(const Duration(milliseconds: 1));
      expect(endpoints, 1);
      expect(finals.last, 'earlier repeated portion');
      old.segment('late', 'stale');
      expect(finals.contains('stale'), false);
    },
  );
  test(
    'cancellation fences stale native and network events across question epochs',
    () async {
      await start();
      final old = transports.single, epoch = pcm.epoch;
      service.clearCapture();
      old.segment('late', 'wrong question');
      pcm.chunk(atEpoch: epoch);
      expect(finals, isEmpty);
      expect(partials, isEmpty);
    },
  );
  test(
    'reconnect reconciles finals persisted after disconnect and keeps the unfinished draft diagnostic',
    () async {
      await start();
      final old = transports.single;
      old.segment('draft', 'unfinished', partial: true);
      old.bus.add({'type': 'error', 'code': 'audio_disconnected'});
      await Future<void>.delayed(Duration.zero);
      resumeEvidence = {
        'streamId': old.ticket!['streamId'],
        'captureId': old.ticket!['captureId'],
        'originalTranscript': 'server confirmed',
        'segments': [
          {
            ...old.ticket!,
            'provider': 'aws-transcribe',
            'resultId': 'final',
            'partial': false,
            'text': 'server confirmed',
            'start': 0.0,
            'end': .5,
            'words': <dynamic>[],
          },
        ],
      };
      await start();
      expect(finals.last, 'server confirmed');
      expect(service.diagnostics['interruptedDrafts'], ['unfinished']);
      pcm.chunk();
      expect(service.diagnostics['interruptionToResumedAudioMs'], hasLength(1));
      expect(service.requiresRecoveryConfirmation, true);
    },
  );
}
