import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/shared/services/stt_service.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'platform_speech_capture_test.dart' as platform;
import 'account_isolation_test.dart' as fixture;
import 'interview_reconnect_contract_test.dart' as transport;
import 'interview_replay_test.dart' as replay;

class HungCancelSpeech extends platform.PhoneSpeech {
  final cancellation = Completer<void>();
  @override
  Future<void> cancel(int value) => value == epoch && epoch != 0 ? cancellation.future : Future.value();
}

void main() {
  testWidgets(
    'hung cancellation cannot wedge recovery or submit retained draft',
    (tester) async {
      final phone = HungCancelSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: SttService(source: phone),
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('partial', text: 'saved draft');
      phone.emit('error', text: 'error_network');
      await tester.pump();
      for (var attempt = 0; attempt < 3; attempt++) {
        expect(p.recoveryAttempt, attempt + 1);
        await tester.pump(const Duration(seconds: 3));
        await tester.pump();
      }
      expect(phone.starts, 1);
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.partialTranscript, 'saved draft');
      expect(p.needsScreenAwake, false);
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      phone.cancellation.complete();
      await tester.pump();
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets('real service final submits immediately once with current IDs', (
    tester,
  ) async {
    final phone = platform.PhoneSpeech(), socket = transport.Socket();
    final p = InterviewProvider(
      sttService: SttService(source: phone),
      ttsService: fixture.FakeTts(),
    )..debugAttachSocket(socket, 's');
    socket.question('q0', 0);
    await tester.pump();
    await tester.pump();
    phone.emit('partial', text: 'flitter');
    phone.emit('final', text: 'Flutter');
    final answers = socket.sent.where((m) => m['type'] == 'turn_submit');
    expect(answers, hasLength(1));
    expect(answers.single['payload']['textTranscript'], 'Flutter');
    expect(answers.single['payload']['turnId'], 'q0');
    phone.emit('final', text: 'duplicate');
    await tester.pump(const Duration(seconds: 6));
    expect(answers, hasLength(1));
    p.dispose();
    socket.dispose();
    await tester.pump();
    await phone.controller.close();
  });
  testWidgets(
    'reconnect and Replay retain draft as an explicit continuation prefix',
    (tester) async {
      final phone = platform.PhoneSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: SttService(source: phone),
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('partial', text: 'I built');
      await replay.recover(tester, socket);
      await p.replayQuestion();
      await tester.pump();
      expect(p.partialTranscript, 'I built');
      expect(p.errorMessage, contains('Continue after the words shown'));
      phone.emit('partial', text: 'a Flutter');
      phone.emit('final', text: 'a Flutter application');
      final answers = socket.sent.where((m) => m['type'] == 'turn_submit');
      expect(answers, hasLength(1));
      expect(
        answers.single['payload']['textTranscript'],
        'I built a Flutter application',
      );
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets(
    'real service errors exhaust exactly three retries, keep draft and release awake',
    (tester) async {
      final phone = platform.PhoneSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: SttService(source: phone),
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('partial', text: 'saved draft');
      for (var attempt = 0; attempt < 4; attempt++) {
        phone.emit('error', text: 'error_network');
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        await tester.pump();
        if (attempt < 3) expect(p.recoveryAttempt, attempt + 1);
      }
      expect(phone.starts, 4);
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.partialTranscript, 'saved draft');
      expect(p.needsScreenAwake, false);
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      await tester.pump(const Duration(seconds: 45));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets('permission failure does not attempt automatic recovery', (
    tester,
  ) async {
    final phone = platform.PhoneSpeech(), socket = transport.Socket();
    final p = InterviewProvider(
      sttService: SttService(source: phone),
      ttsService: fixture.FakeTts(),
    )..debugAttachSocket(socket, 's');
    p.debugStartListening();
    await tester.pump();
    phone.emit('partial', text: 'saved');
    phone.emit('error', code: 9);
    await tester.pump(const Duration(seconds: 45));
    expect(phone.starts, 1);
    expect(p.microphoneAvailable, false);
    expect(p.recoveryAttempt, 0);
    expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
    p.dispose();
    socket.dispose();
    await tester.pump();
    await phone.controller.close();
  });
  for (final action in ['end', 'logout', 'dispose', 'background']) {
    testWidgets('late plugin final after $action cannot submit or restart', (
      tester,
    ) async {
      final phone = platform.PhoneSpeech(), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: SttService(source: phone),
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      p.debugStartListening();
      await tester.pump();
      phone.emit('partial', text: 'saved');
      final old = phone.epoch;
      if (action == 'end') unawaited(p.endSession());
      if (action == 'logout') p.resetForUser(null);
      if (action == 'dispose') p.dispose();
      if (action == 'background') {
        p.handleLifecycleState(AppLifecycleState.paused);
      }
      phone.emit('final', text: 'late', oldEpoch: old);
      phone.emit('done', oldEpoch: old);
      await tester.pump(const Duration(seconds: 45));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      expect(phone.starts, 1);
      if (action != 'dispose') p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    });
  }
}
