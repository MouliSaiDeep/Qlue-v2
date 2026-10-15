import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/screens/interview/interview_recovery_controls.dart';
import 'account_isolation_test.dart' as fixture;

class Capture extends fixture.FakeStt {
  Function(SpeechRecognitionError)? error;
  Function(String)? status;
  Completer<void>? stopGate;
  Completer<void>? startGate;
  int starts = 0;
  @override
  Future<void> startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    starts++;
    if (startGate != null) await startGate!.future;
    super.startListening(onPartial: onPartial, onFinal: onFinal);
    error = onError;
    status = onStatus;
  }

  @override
  Future<void> stopCapture() async {
    stop();
    await stopGate?.future;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('slow microphone startup is not submitted as user silence', (
    tester,
  ) async {
    final mic = Capture()..startGate = Completer<void>();
    final p = InterviewProvider(sttService: mic, ttsService: fixture.FakeTts());
    p.debugStartListening();
    await tester.pump(const Duration(seconds: 6));
    expect(p.transcript, isEmpty);
    mic.startGate!.complete();
    await tester.pump();
    await tester.pump(InterviewProvider.silenceDuration);
    await tester.pump();
    expect(p.transcript.single.text, '');
    p.dispose();
  });
  testWidgets('delayed final ASR arriving during shutdown is retained', (
    tester,
  ) async {
    final mic = Capture();
    final p = InterviewProvider(sttService: mic, ttsService: fixture.FakeTts());
    p.debugStartListening();
    mic.onPartialCb!('earlier');
    mic.stopGate = Completer<void>();
    final completion = p.doneSpeaking();
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    mic.onFinalCb!('earlier complete sentence');
    mic.stopGate!.complete();
    await completion;
    expect(p.transcript.single.text, 'earlier complete sentence');
    p.dispose();
  });

  testWidgets(
    'notListening before an error cannot bypass the three-retry limit',
    (tester) async {
      final mic = Capture();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugStartListening();
      mic.onPartialCb!('draft');
      for (var i = 0; i < 3; i++) {
        mic.status!('notListening');
        mic.error!(SpeechRecognitionError('error_network', true));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        expect(p.recoveryAttempt, i + 1);
      }
      mic.status!('notListening');
      mic.error!(SpeechRecognitionError('error_network', true));
      await tester.pump(const Duration(seconds: 10));
      expect(mic.starts, 4);
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.transcript, isEmpty);
      p.dispose();
    },
  );
  testWidgets('stable 40-second fallback sends once; late final ignored', (
    tester,
  ) async {
    final mic = Capture();
    final p = InterviewProvider(sttService: mic, ttsService: fixture.FakeTts());
    p.debugStartListening();
    mic.onPartialCb!('my answer');
    final late = mic.onFinalCb!;
    await tester.pump(const Duration(seconds: 39));
    expect(p.transcript, isEmpty);
    expect(mic.isListening, isTrue);
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(mic.isListening, isFalse);
    expect(p.transcript.map((e) => e.text), ['my answer']);
    late('late answer');
    await tester.pump();
    expect(p.transcript.length, 1);
    p.dispose();
  });
  testWidgets(
    'empty next capture cannot reuse previous answer or its late callback',
    (tester) async {
      final mic = Capture();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugStartListening();
      mic.onPartialCb!('previous');
      final old = mic.onPartialCb!;
      await tester.pump(InterviewProvider.silenceDuration);
      await tester.pump();
      p.debugStartListening();
      expect(p.partialTranscript, isEmpty);
      old('old answer');
      await tester
          .pump(); // finish starting the fresh capture before quiet time
      await tester.pump(InterviewProvider.silenceDuration);
      await tester.pump();
      expect(p.transcript.map((e) => e.text), ['previous', '']);
      p.dispose();
    },
  );
  testWidgets(
    'stable plugin final submits at once and replaces partial hypothesis',
    (tester) async {
      final mic = Capture();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugStartListening();
      mic.onPartialCb!('first rough hypothesis');
      mic.onPartialCb!('corrected hypothesis');
      expect(p.partialTranscript, 'corrected hypothesis');
      mic.onFinalCb!('corrected complete answer');
      expect(p.transcript.single.text, 'corrected complete answer');
      await tester.pump(const Duration(seconds: 5));
      expect(p.transcript, hasLength(1));
      p.dispose();
    },
  );
  testWidgets(
    'duplicate hypotheses do not duplicate words or postpone the endpoint',
    (tester) async {
      final mic = Capture();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugStartListening();
      mic.onPartialCb!('once');
      await tester.pump(const Duration(seconds: 3));
      mic.onPartialCb!('once');
      await tester.pump(const Duration(seconds: 37));
      await tester.pump();
      expect(p.transcript.single.text, 'once');
      p.dispose();
    },
  );
  testWidgets('stable safety fallback uses latest partial after 40 seconds', (
    tester,
  ) async {
    final mic = Capture();
    final p = InterviewProvider(sttService: mic, ttsService: fixture.FakeTts());
    p.debugStartListening();
    await tester.pump();
    for (var i = 0; i < 9; i++) {
      mic.onPartialCb!('answer up to word $i');
      await tester.pump(const Duration(seconds: 4));
    }
    expect(p.transcript, isEmpty);
    mic.onPartialCb!('latest draft');
    await tester.pump(const Duration(seconds: 4));
    await tester.pump();
    expect(p.transcript.single.text, 'latest draft');
    p.dispose();
  });
  testWidgets('finalization gate closes before awaiting native shutdown', (
    tester,
  ) async {
    final mic = Capture()..stopGate = Completer<void>();
    final p = InterviewProvider(sttService: mic, ttsService: fixture.FakeTts());
    p.debugStartListening();
    mic.onPartialCb!('once');
    final first = p.doneSpeaking();
    final second = p.doneSpeaking();
    mic.onFinalCb!('late');
    expect(p.transcript, isEmpty);
    mic.stopGate!.complete();
    await first;
    await second;
    expect(p.transcript.length, 1);
    p.dispose();
  });
  testWidgets('switch during native shutdown drops capture', (tester) async {
    final mic = Capture()..stopGate = Completer<void>();
    final p = InterviewProvider(sttService: mic, ttsService: fixture.FakeTts());
    p.debugStartListening();
    mic.onPartialCb!('account A');
    final pending = p.doneSpeaking();
    p.resetForUser('B');
    mic.stopGate!.complete();
    await pending;
    expect(p.transcript, isEmpty);
    p.dispose();
  });
  testWidgets(
    'recognition errors retry three times then preserve the draft without sending',
    (tester) async {
      final mic = Capture();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugStartListening();
      mic.onPartialCb!('saved');
      for (var i = 0; i < 3; i++) {
        mic.error!(SpeechRecognitionError('error_network', true));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        expect(p.recoveryAttempt, i + 1);
      }
      mic.error!(SpeechRecognitionError('error_network', true));
      await tester.pump(const Duration(seconds: 10));
      expect(mic.starts, 4);
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.partialTranscript, 'saved');
      expect(p.transcript, isEmpty);
      p.dispose();
    },
  );
  testWidgets(
    'normal interview has passive guidance and no manual answer or recovery buttons',
    (tester) async {
      final p = InterviewProvider(
        sttService: Capture(),
        ttsService: fixture.FakeTts(),
      );
      p.debugStartListening();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: InterviewRecoveryControls(provider: p)),
        ),
      );
      expect(find.textContaining('4 seconds of silence'), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      p.dispose();
    },
  );
}
