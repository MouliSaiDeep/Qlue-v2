import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'helpers/pcm_endpoint.dart';

import 'account_isolation_test.dart' as fixture;
import 'interview_reconnect_contract_test.dart' as transport;

// Tests provider orchestration at the audio/ASR boundary. Detector correctness
// is separately exercised with actual ONNX models and recorded PCM in audit/.
class ControlledSpeech extends fixture.FakeStt {
  @override
  bool get usesAudioEndpoint => true;
  AudioEndpoint clock = AudioEndpoint();
  Function(SpeechRecognitionError)? failure;
  Completer<void>? finalization;
  String? completedText;
  bool failFinalization = false;
  @override
  bool get stableTranscript => true;
  @override
  bool get heardSpeech => clock.heardSpeech;
  @override
  void configureCapture({
    required String identity,
    required bool preserve,
    required void Function(bool) onActivity,
    required void Function() onEndpoint,
  }) {
    activity = onActivity;
    endpoint = onEndpoint;
    if (!preserve) {
      clock = AudioEndpoint();
    } else {
      clock.resume();
    }
  }

  @override
  Future<void> startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    clock.resume();
    onPartialCb = onPartial;
    onFinalCb = onFinal;
    failure = onError;
  }

  void audio(bool speech, Duration duration) {
    final samples = duration.inMicroseconds * 16000 ~/ 1000000;
    for (var i = 0; i < samples; i += 512) {
      final count = (samples - i).clamp(0, 512);
      activity?.call(speech);
      if (clock.accept(speech: speech, samples: count) != null) {
        endpoint?.call();
      }
    }
  }

  @override
  Future<void> stopCaptureAndFlush() async {
    await finalization?.future;
    if (failFinalization) throw StateError('asr unavailable');
    if (completedText != null) onFinalCb?.call(completedText!);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'two-second pause retains both segments and four seconds submits once after flush',
    (tester) async {
      final mic = ControlledSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.finalization = Completer<void>();
      mic.audio(true, const Duration(seconds: 1));
      mic.onFinalCb!('my background');
      mic.audio(false, const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 2));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      expect(p.partialTranscript, 'my background');
      mic.audio(true, const Duration(seconds: 1));
      mic.onPartialCb!('my background and experience');
      mic.onFinalCb!('my background and experience');
      mic.audio(false, const Duration(milliseconds: 3999));
      await tester.pump();
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      mic.audio(false, const Duration(milliseconds: 1));
      await tester.pump();
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      mic.completedText = 'my background and experience with Qlue';
      mic.finalization!.complete();
      await tester.pump();
      expect(
        socket.sent.single['payload']['textTranscript'],
        'my background and experience with Qlue',
      );
      mic.endpoint!();
      mic.onFinalCb!('late fragment');
      await tester.pump();
      expect(
        socket.sent.where((m) => m['type'] == 'turn_submit'),
        hasLength(1),
      );
      p.dispose();
      socket.dispose();
    },
  );
  testWidgets(
    'recognizer errors keep draft, exhaust three recoveries and release awake',
    (tester) async {
      final mic = ControlledSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onPartialCb!('retained draft');
      for (var i = 0; i < 4; i++) {
        mic.failure!(SpeechRecognitionError('error_network', true));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
      }
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      expect(p.partialTranscript, 'retained draft');
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.needsScreenAwake, false);
      p.dispose();
      socket.dispose();
    },
  );
  testWidgets(
    'VAD recovery uses the retained complete transcript without duplicating its prefix',
    (tester) async {
      final mic = ControlledSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.audio(true, const Duration(seconds: 1));
      mic.onFinalCb!('first part');
      mic.failure!(SpeechRecognitionError('audio_stream_missing', true));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      mic.onPartialCb!('first part and second part');
      expect(p.partialTranscript, 'first part and second part');
      mic.audio(true, const Duration(seconds: 45));
      await tester.pump(const Duration(seconds: 45));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      mic.audio(false, const Duration(seconds: 4));
      await tester.pump();
      expect(
        socket.sent.single['payload']['textTranscript'],
        'first part and second part',
      );
      p.dispose();
      socket.dispose();
    },
  );
  testWidgets(
    'failed VAD flush retains draft and uses only three provider recoveries',
    (tester) async {
      final mic = ControlledSpeech();
      final socket = transport.Socket();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onFinalCb!('complete retained draft');
      mic.failFinalization = true;
      for (var i = 0; i < 4; i++) {
        mic.audio(true, const Duration(seconds: 1));
        mic.audio(false, const Duration(seconds: 4));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
      }
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      expect(p.partialTranscript, 'complete retained draft');
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.needsScreenAwake, false);
      p.dispose();
      socket.dispose();
    },
  );
  testWidgets(
    'background and next-question guards reject obsolete recognition and endpoints',
    (tester) async {
      final mic = ControlledSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onPartialCb!('saved draft');
      final oldFinal = mic.onFinalCb!, oldEndpoint = mic.endpoint!;
      p.handleLifecycleState(AppLifecycleState.paused);
      oldFinal('obsolete');
      oldEndpoint();
      await tester.pump();
      expect(p.partialTranscript, 'saved draft');
      expect(p.needsScreenAwake, false);
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      p.handleLifecycleState(AppLifecycleState.resumed);
      socket.question('q1', 1);
      await tester.pump();
      await tester.pump();
      oldFinal('obsolete next question');
      oldEndpoint();
      expect(p.currentQuestionIdentity, 'q1');
      expect(p.partialTranscript, isEmpty);
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      p.dispose();
      socket.dispose();
    },
  );
  test(
    'audio continuity rejects missing frames, wrong encoding metadata and capture clock jumps',
    () {
      PcmFrame frame(int sequence, int position, int time) => PcmFrame(
        pcm: Uint8List(1024),
        sequence: sequence,
        firstFrame: position,
        sampleTimeUs: time,
        epoch: 4,
      );
      final continuity = PcmContinuity();
      continuity.accept(frame(0, 0, 1000000), 4);
      expect(
        () => continuity.accept(frame(2, 1024, 1064000), 4),
        throwsStateError,
      );
      final discontinuous = PcmContinuity();
      discontinuous.accept(frame(0, 0, 1000000), 4);
      expect(
        () => discontinuous.accept(frame(1, 512, 1200000), 4),
        throwsStateError,
      );
    },
  );

  final frames =
      jsonDecode(File('test/fixtures/handler-errors.json').readAsStringSync())
          as Map;
  testWidgets(
    'actual handler-emitted throttling frame retries the original saved answer up to three times',
    (tester) async {
      final mic = ControlledSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await p.submitTypedAnswer('retained real handler test');
      final original = Map<String, dynamic>.from(socket.sent.single['payload']);
      for (var attempt = 0; attempt < 4; attempt++) {
        socket.events.add(Map<String, dynamic>.from(frames['session_init']));
        await tester.pump();
        await tester.pump(const Duration(seconds: 2));
      }
      final submits = socket.sent
          .where((m) => m['type'] == 'turn_submit')
          .toList();
      expect(submits.length, 4);
      for (final m in submits) {
        expect(m['payload'], original);
      }
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.hasPendingAnswer, true);
      expect(p.isSessionEnded, false);
      expect(p.needsScreenAwake, false);
      p.dispose();
      socket.dispose();
    },
  );
  for (final label in ['malformed', 'forbidden', 'missing', 'terminal']) {
    testWidgets('actual handler $label frame remains terminal', (tester) async {
      final socket = transport.Socket(),
          p = InterviewProvider(
            sttService: ControlledSpeech(),
            ttsService: fixture.FakeTts(),
          );
      p.debugAttachSocket(socket, 's');
      socket.events.add(Map<String, dynamic>.from(frames[label]));
      await tester.pump();
      await tester.pump(const Duration(seconds: 20));
      expect(p.currentPhase, InterviewPhase.error);
      expect(socket.sent, isEmpty);
      expect(p.isSessionEnded, false);
      p.dispose();
      socket.dispose();
    });
  }
  testWidgets(
    'delayed error scoped to previous question cannot stop current capture',
    (tester) async {
      final socket = transport.Socket(),
          p = InterviewProvider(
            sttService: ControlledSpeech(),
            ttsService: fixture.FakeTts(),
          );
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      socket.question('q1', 1);
      await tester.pump();
      await tester.pump();
      socket.events.add({
        'type': 'turn_error',
        'payload': {
          'sessionId': 's',
          'turnId': 'q0',
          'code': 403,
          'retryable': false,
        },
      });
      await tester.pump();
      expect(p.currentPhase, InterviewPhase.listening);
      p.dispose();
      socket.dispose();
    },
  );

  for (final alwaysFails in [false, true]) {
    testWidgets(
      alwaysFails
          ? 'token failures exhaust three actual retries'
          : 'first token fails; next succeeds and reconciles same session',
      (tester) async {
        final auth = fixture.MockFirebaseAuth(), user = fixture.MockUser();
        when(() => auth.currentUser).thenReturn(user);
        when(() => user.uid).thenReturn('u');
        var calls = 0, created = 0;
        when(() => user.getIdToken(true)).thenAnswer((_) async {
          calls++;
          if (alwaysFails || calls == 1) {
            throw FirebaseAuthException(code: 'network-request-failed');
          }
          return 'refreshed';
        });
        final socket = fixture.FakeWs();
        final p = InterviewProvider(
          auth: auth,
          sttService: ControlledSpeech(),
          ttsService: fixture.FakeTts(),
          wsFactory: ({required url, required userId, required sessionId}) {
            created++;
            return socket;
          },
        );
        p.sessionId = 's';
        p.partialTranscript = 'saved draft';
        await p.resumeSession();
        for (var i = 0; i < (alwaysFails ? 3 : 1); i++) {
          await tester.pump(const Duration(seconds: 2));
          await tester.pump();
        }
        expect(calls, alwaysFails ? 4 : 2);
        expect(created, alwaysFails ? 0 : 1);
        expect(p.partialTranscript, 'saved draft');
        if (alwaysFails) {
          expect(p.currentPhase, InterviewPhase.error);
          expect(p.needsScreenAwake, false);
        } else {
          expect(socket.sentMessages.single['type'], 'session_reconnect');
        }
        p.dispose();
        socket.dispose();
      },
    );
  }
  for (final action in ['logout', 'background', 'route']) {
    testWidgets(
      '$action during token acquisition cannot connect obsolete account',
      (tester) async {
        final auth = fixture.MockFirebaseAuth(),
            user = fixture.MockUser(),
            gate = Completer<String?>();
        when(() => auth.currentUser).thenReturn(user);
        when(() => user.uid).thenReturn('u');
        when(() => user.getIdToken(true)).thenAnswer((_) => gate.future);
        var created = 0;
        final p = InterviewProvider(
          auth: auth,
          sttService: ControlledSpeech(),
          ttsService: fixture.FakeTts(),
          wsFactory: ({required url, required userId, required sessionId}) {
            created++;
            return fixture.FakeWs();
          },
        );
        p.sessionId = 's';
        final pending = p.resumeSession();
        if (action == 'logout') {
          when(() => auth.currentUser).thenReturn(null);
          p.resetForUser(null);
        }
        if (action == 'background') {
          p.handleLifecycleState(AppLifecycleState.paused);
        }
        if (action == 'route') p.leaveRoute();
        gate.complete('old-token');
        await pending;
        await tester.pump(const Duration(seconds: 20));
        expect(created, 0);
        expect(p.needsScreenAwake, false);
        p.dispose();
      },
    );
  }
}
