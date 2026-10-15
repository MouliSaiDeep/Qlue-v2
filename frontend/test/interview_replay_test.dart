import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/screens/interview/interview_recovery_controls.dart';
import 'account_isolation_test.dart' as fixture;
import 'interview_reconnect_contract_test.dart' as reconnect;

class ReplayAudio extends fixture.FakeTts {
  final urls = <String>[], inline = <String>[];
  Completer<void>? gate;
  int stops = 0;
  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<void> playUrl(String url) async {
    urls.add(url);
    await gate?.future;
  }

  @override
  Future<void> playBase64(String data) async {
    inline.add(data);
    await gate?.future;
  }
}

class FailedAudio extends ReplayAudio {
  bool fail = false;
  @override
  Future<void> playUrl(String url) async {
    urls.add(url);
    if (fail && !url.endsWith('/fresh')) throw StateError('expired');
  }
}

class ClosingMic extends fixture.FakeStt {
  Completer<void>? closeGate;
  Completer<void>? stopGate;
  bool fail = false;
  @override
  Future<void> stopCapture() async {
    await stopGate?.future;
    stop();
  }

  @override
  Future<void> stopCaptureAndFlush() async {
    if (fail) throw StateError('native stop failed');
    await closeGate?.future;
    stop();
  }
}

Future<void> recover(WidgetTester tester, reconnect.Socket socket) async {
  socket.drops.add(null);
  await tester.pump();
  socket.resumes.add(null);
  await tester.pump();
  socket.question('q0', 0);
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets(
    'only the recovered unanswered question offers Replay; automatic capture needs no tap',
    (tester) async {
      final mic = fixture.FakeStt(), socket = reconnect.Socket();
      final p = InterviewProvider(sttService: mic, ttsService: ReplayAudio())
        ..debugAttachSocket(socket, 's');
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListenableBuilder(
              listenable: p,
              builder: (_, _) => InterviewRecoveryControls(provider: p),
            ),
          ),
        ),
      );
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('replay-question')), findsNothing);
      await recover(tester, socket);
      expect(p.isListening, isTrue);
      expect(find.byKey(const Key('replay-question')), findsOneWidget);
      expect(p.canReplayQuestion, isTrue);
      await p.submitTypedAnswer('answer');
      await tester.pump();
      expect(p.canReplayQuestion, isFalse);
      expect(
        tester
            .widget<TextButton>(find.byKey(const Key('replay-question')))
            .onPressed,
        isNull,
      );
      socket.question('q1', 1);
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('replay-question')), findsNothing);
      expect(p.partialTranscript, isEmpty);
      socket.drops.add(null);
      await tester.pump();
      socket.resumes.add(null);
      await tester.pump();
      socket.events.add({
        'type': 'turn_complete',
        'payload': {
          'sessionId': 's',
          'turnId': 'closing',
          'turnIndex': 2,
          'questionText': 'Goodbye',
          'expectsAnswer': false,
        },
      });
      await tester.pump();
      await tester.pump();
      expect(p.replayQuestionAvailable, isFalse);
      expect(p.isListening, isFalse);
      await tester.pumpWidget(const SizedBox());
      p.dispose();
      socket.dispose();
    },
  );
  testWidgets(
    'replay of a recovered question preserves its unsubmitted draft',
    (tester) async {
      final mic = fixture.FakeStt(),
          audio = ReplayAudio(),
          socket = reconnect.Socket();
      final p = InterviewProvider(sttService: mic, ttsService: audio)
        ..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onPartialCb!('saved before interruption');
      await recover(tester, socket);
      await p.replayQuestion();
      await tester.pump();
      expect(p.partialTranscript, 'saved before interruption');
      expect(p.isListening, isTrue);
      expect(p.transcript.where((e) => e.role == 'AI').length, 1);
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      p.dispose();
      socket.dispose();
    },
  );
  testWidgets('base64-only question replay uses the stored audio', (
    tester,
  ) async {
    final audio = ReplayAudio(), socket = reconnect.Socket();
    final p = InterviewProvider(
      sttService: fixture.FakeStt(),
      ttsService: audio,
    )..debugAttachSocket(socket, 's');
    final question = {
      'type': 'turn_complete',
      'payload': {
        'sessionId': 's',
        'turnId': 'q0',
        'turnIndex': 0,
        'questionText': 'Question?',
        'expectsAnswer': true,
        'audioData': 'c3RvcmVk',
      },
    };
    socket.events.add(question);
    await tester.pump();
    await tester.pump();
    socket.drops.add(null);
    await tester.pump();
    socket.resumes.add(null);
    await tester.pump();
    socket.events.add(question);
    await tester.pump();
    await tester.pump();
    await p.replayQuestion();
    await tester.pump();
    expect(audio.inline, ['c3RvcmVk', 'c3RvcmVk']);
    p.dispose();
    socket.dispose();
  });
  testWidgets('rapid replay taps start only one playback', (tester) async {
    final audio = ReplayAudio(), socket = reconnect.Socket();
    final p = InterviewProvider(
      sttService: fixture.FakeStt(),
      ttsService: audio,
    )..debugAttachSocket(socket, 's');
    socket.question('q0', 0);
    await tester.pump();
    await tester.pump();
    await recover(tester, socket);
    audio.gate = Completer<void>();
    final first = p.replayQuestion();
    await tester.pump();
    final second = p.replayQuestion();
    await tester.pump();
    expect(audio.urls.length, 2);
    audio.gate!.complete();
    await first;
    await second;
    p.dispose();
    socket.dispose();
  });
  testWidgets('terminal backend error stops without endlessly processing', (
    tester,
  ) async {
    final socket = reconnect.Socket();
    final p = InterviewProvider(
      sttService: fixture.FakeStt(),
      ttsService: ReplayAudio(),
    )..debugAttachSocket(socket, 's');
    p.debugStartListening();
    await p.submitTypedAnswer('saved');
    socket.events.add({
      'type': 'turn_error',
      'payload': {
        'sessionId': 's',
        'terminal': true,
        'code': 409,
        'error': 'TURN_RECOVERY_EXHAUSTED',
      },
    });
    await tester.pump();
    await tester.pump(const Duration(seconds: 2));
    expect(p.currentPhase, InterviewPhase.error);
    expect(socket.sent.where((m) => m['type'] == 'turn_submit').length, 1);
    p.dispose();
    socket.dispose();
  });

  testWidgets(
    'interrupted audio automatically replays after reconciliation, then permits optional replay',
    (tester) async {
      final audio = ReplayAudio()..gate = Completer<void>(),
          mic = fixture.FakeStt(),
          socket = reconnect.Socket();
      final p = InterviewProvider(sttService: mic, ttsService: audio)
        ..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      socket.drops.add(null);
      await tester.pump();
      audio.gate!.complete();
      await tester.pump();
      expect(mic.isListening, isFalse);
      socket.resumes.add(null);
      await tester.pump();
      audio.gate = null;
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      expect(audio.urls.length, 2);
      expect(p.isListening, isTrue);
      expect(p.canReplayQuestion, isTrue);
      await p.replayQuestion();
      expect(audio.urls.length, 3);
      expect(p.transcript.length, 1);
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'replay cancels silence before shutdown, includes late final words and gives a fresh capture window',
    (tester) async {
      final mic = ClosingMic(),
          audio = ReplayAudio(),
          socket = reconnect.Socket();
      final p = InterviewProvider(sttService: mic, ttsService: audio)
        ..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await recover(tester, socket);
      mic.onPartialCb!('partial');
      await tester.pump(const Duration(seconds: 4));
      mic.closeGate = Completer<void>();
      audio.gate = Completer<void>();
      final replay = p.replayQuestion();
      await tester.pump();
      await tester.pump(const Duration(seconds: 6));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      mic.onFinalCb!('final corrected words');
      mic.closeGate!.complete();
      await tester.pump();
      await tester.pump(const Duration(seconds: 6));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      audio.gate!.complete();
      await replay;
      await tester.pump();
      expect(p.partialTranscript, 'final corrected words');
      await tester.pump(const Duration(seconds: 39));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      expect(socket.sent.where((m) => m['type'] == 'turn_submit').length, 1);
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'a newer question invalidates replay completion and old speech callbacks',
    (tester) async {
      final mic = fixture.FakeStt(),
          audio = ReplayAudio(),
          socket = reconnect.Socket();
      final p = InterviewProvider(sttService: mic, ttsService: audio)
        ..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await recover(tester, socket);
      mic.onPartialCb!('old draft');
      final oldFinal = mic.onFinalCb!;
      audio.gate = Completer<void>();
      final replay = p.replayQuestion();
      await tester.pump();
      final oldGate = audio.gate!;
      audio.gate = null;
      socket.question('q1', 1);
      await tester.pump();
      await tester.pump();
      oldFinal('obsolete');
      oldGate.complete();
      await replay;
      await tester.pump();
      expect(p.currentQuestionIdentity, 'q1');
      expect(p.partialTranscript, isEmpty);
      expect(p.replayQuestionAvailable, isFalse);
      expect(p.isListening, isTrue);
      p.dispose();
      socket.dispose();
    },
  );

  for (final exit in [
    'end',
    'logout',
    'background',
    'disconnect',
    'navigation',
  ]) {
    testWidgets('$exit during replay prevents late capture reactivation', (
      tester,
    ) async {
      final mic = fixture.FakeStt(),
          audio = ReplayAudio(),
          socket = reconnect.Socket();
      final p = InterviewProvider(sttService: mic, ttsService: audio)
        ..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await recover(tester, socket);
      audio.gate = Completer<void>();
      final replay = p.replayQuestion();
      await tester.pump();
      Future<void>? ending;
      switch (exit) {
        case 'end':
          ending = p.endSession();
        case 'logout':
          p.resetForUser(null);
        case 'background':
          p.handleLifecycleState(AppLifecycleState.paused);
        case 'disconnect':
          socket.drops.add(null);
        case 'navigation':
          p.leaveRoute();
      }
      await tester.pump();
      audio.gate!.complete();
      await replay;
      await tester.pump(const Duration(seconds: 1));
      if (ending != null) await ending;
      expect(mic.isListening, isFalse);
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      p.dispose();
      socket.dispose();
    });
  }

  testWidgets(
    'expired audio refresh reuses the question object without submitting or adding a turn',
    (tester) async {
      final audio = FailedAudio(), socket = reconnect.Socket();
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: audio,
      )..debugAttachSocket(socket, 's');
      final question = {
        'type': 'turn_complete',
        'payload': {
          'sessionId': 's',
          'turnId': 'q0',
          'turnIndex': 0,
          'questionText': 'Question?',
          'expectsAnswer': true,
          'audioUrl': 'https://audio/old',
          'audioRefreshable': true,
        },
      };
      socket.events.add(question);
      await tester.pump();
      await tester.pump();
      await recover(tester, socket);
      audio.fail = true;
      final replay = p.replayQuestion();
      await tester.pump();
      expect(socket.sent.last['payload'], {
        'sessionId': 's',
        'turnId': 'q0',
        'audioOnly': true,
      });
      socket.events.add({
        'type': 'question_audio',
        'payload': {
          'sessionId': 's',
          'turnId': 'q0',
          'audioUrl': 'https://audio/fresh',
        },
      });
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await replay;
      expect(audio.urls.last, 'https://audio/fresh');
      expect(p.isListening, isTrue);
      expect(p.transcript.length, 1);
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'unavailable audio stops after three retries and a missing refresh times out',
    (tester) async {
      final audio = FailedAudio()..fail = true, socket = reconnect.Socket();
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: audio,
      )..debugAttachSocket(socket, 's');
      socket.events.add({
        'type': 'turn_complete',
        'payload': {
          'sessionId': 's',
          'turnId': 'q0',
          'turnIndex': 0,
          'questionText': 'Question?',
          'expectsAnswer': true,
          'audioUrl': 'https://audio/old',
          'audioRefreshable': true,
        },
      });
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(seconds: 1));
      }
      await tester.pump();
      expect(audio.urls.length, 4);
      expect(p.isListening, isTrue);
      expect(p.errorMessage, contains('Read the question'));
      expect(
        socket.sent.where((m) => m['payload']?['audioOnly'] == true).length,
        1,
      );
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'failed microphone shutdown never plays audio or restarts capture',
    (tester) async {
      final mic = ClosingMic(),
          audio = ReplayAudio(),
          socket = reconnect.Socket();
      final p = InterviewProvider(sttService: mic, ttsService: audio)
        ..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await recover(tester, socket);
      mic.onPartialCb!('saved');
      mic.fail = true;
      await p.replayQuestion();
      await tester.pump();
      expect(audio.urls.length, 1);
      expect(p.currentPhase, InterviewPhase.error);
      expect(mic.isListening, isFalse);
      expect(p.partialTranscript, 'saved');
      p.dispose();
      socket.dispose();
    },
  );
  testWidgets('a delayed End from account A cannot clean up account B', (
    tester,
  ) async {
    final mic = ClosingMic(),
        socket = reconnect.Socket(),
        audio = ReplayAudio();
    final p = InterviewProvider(sttService: mic, ttsService: audio)
      ..debugAttachSocket(socket, 's');
    socket.question('q0', 0);
    await tester.pump();
    await tester.pump();
    mic.stopGate = Completer<void>();
    final end = p.endSession();
    await tester.pump();
    p.resetForUser('B');
    p.resetForNewSession();
    final stoppedBefore = audio.stops;
    final next = reconnect.Socket();
    p.debugAttachSocket(next, 's');
    mic.stopGate!.complete();
    await end;
    expect(audio.stops, stoppedBefore);
    next.question('q1', 1);
    await tester.pump();
    await tester.pump();
    expect(p.isSessionEnded, isFalse);
    expect(p.isListening, isTrue);
    expect(p.currentQuestionIdentity, 'q1');
    p.dispose();
    socket.dispose();
    next.dispose();
  });
}
