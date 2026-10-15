import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'platform_speech_capture_test.dart' show PhoneSpeech;
import 'system_speech_stt_service_test.dart' show service;
import 'account_isolation_test.dart' as fixture;
import 'interview_reconnect_contract_test.dart' as transport;

class FailingStartPhone extends PhoneSpeech {
  bool fail = true;
  @override
  Future<void> start(int value) async {
    await super.start(value);
    if (fail) throw StateError('startup failure');
  }
}

// Audit probes assert observed defects, not desired production behavior.
void main() {
  testWidgets('provider waits for native readiness', (tester) async {
    final phone = PhoneSpeech()..autoReady = false;
    final speech = service(tester, phone);
    final socket = transport.Socket();
    final p = InterviewProvider(
      sttService: speech,
      ttsService: fixture.FakeTts(),
    )..debugAttachSocket(socket, 's');
    socket.question('q0', 0);
    await tester.pump();
    await tester.pump();
    expect(phone.starts, 1);
    expect(speech.isListening, isFalse);
    expect(p.isListening, isFalse);
    p.dispose();
    socket.dispose();
    await tester.pump();
    await phone.controller.close();
  });

  testWidgets('failed partial remains unconfirmed after recovery', (
    tester,
  ) async {
    final phone = PhoneSpeech()..finishOnStop = false;
    final speech = service(tester, phone);
    final socket = transport.Socket();
    final p = InterviewProvider(
      sttService: speech,
      ttsService: fixture.FakeTts(),
    )..debugAttachSocket(socket, 's');
    socket.question('q0', 0);
    await tester.pump();
    await tester.pump();
    phone.emit('speechStart');
    phone.emit('partial', text: 'unfinished incorrect hypothesis');
    phone.emit('error', code: 2);
    await tester.pump();
    expect(socket.sent, isEmpty);
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(phone.starts, 2);
    await tester.pump(const Duration(seconds: 4));
    await tester.pump();
    expect(socket.sent, isEmpty);
    p.dispose();
    socket.dispose();
    await tester.pump();
    await phone.controller.close();
  });

  testWidgets(
    'recovery and stale readiness cannot claim an active microphone',
    (tester) async {
      final phone = PhoneSpeech()..autoReady = false;
      final speech = service(tester, phone), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      final old = phone.epoch;
      expect(p.isListening, isFalse);
      phone.emit('ready');
      expect(p.isListening, isTrue);
      phone.emit('error', code: 2);
      expect(p.isListening, isFalse);
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      phone.emit('ready', oldEpoch: old);
      expect(p.isListening, isFalse);
      phone.emit('ready');
      expect(p.isListening, isTrue);
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets('readiness timeout stays inactive and starts bounded recovery', (
    tester,
  ) async {
    final phone = PhoneSpeech()..autoReady = false;
    final speech = service(tester, phone), socket = transport.Socket();
    final p = InterviewProvider(
      sttService: speech,
      ttsService: fixture.FakeTts(),
    )..debugAttachSocket(socket, 's');
    socket.question('q0', 0);
    await tester.pump();
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));
    expect(p.isListening, isFalse);
    expect(p.recoveryAttempt, 1);
    expect(socket.sent, isEmpty);
    p.dispose();
    socket.dispose();
    await tester.pump();
    await phone.controller.close();
  });
  testWidgets(
    'confirmed content survives and a finalized repeat replaces the interrupted portion once',
    (tester) async {
      final phone = PhoneSpeech();
      final speech = service(tester, phone), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('speechStart');
      phone.emit('segmentFinal', text: 'I build software');
      phone.emit('speechStart');
      phone.emit('partial', text: 'wrong project hypothesis');
      phone.emit('error', code: 2);
      await tester.pump();
      expect(p.partialTranscript, contains('wrong project hypothesis'));
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      phone.emit('speechStart');
      phone.emit('partial', text: 'my repeated project');
      phone.emit('speechEnd');
      phone.emit('final', text: 'my repeated project');
      await tester.pump();
      await tester.pump();
      expect(p.partialTranscript, 'I build software my repeated project');
      await tester.pump(const Duration(milliseconds: 3999));
      expect(socket.sent, isEmpty);
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      expect(
        socket.sent.single['payload']['textTranscript'],
        'I build software my repeated project',
      );
      final old = phone.epoch;
      socket.question('q1', 1);
      await tester.pump();
      await tester.pump();
      phone.emit('final', text: 'late old words', oldEpoch: old);
      expect(p.partialTranscript, isEmpty);
      expect(socket.sent.length, 1);
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets('startup failure does not leave listening true', (tester) async {
    final phone = FailingStartPhone()..autoReady = false;
    final speech = service(tester, phone), socket = transport.Socket();
    final p = InterviewProvider(
      sttService: speech,
      ttsService: fixture.FakeTts(),
    )..debugAttachSocket(socket, 's');
    socket.question('q0', 0);
    await tester.pump();
    await tester.pump();
    expect(p.isListening, isFalse);
    expect(p.recoveryAttempt, 1);
    final old = phone.epoch;
    phone.fail = false;
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    phone.emit('ready', oldEpoch: old);
    expect(p.isListening, isFalse);
    phone.emit('ready');
    expect(p.isListening, isTrue);
    p.dispose();
    socket.dispose();
    await tester.pump();
    await phone.controller.close();
  });
  testWidgets(
    'silence cannot resolve interrupted words and repeat retries remain bounded',
    (tester) async {
      final phone = PhoneSpeech()..finishOnStop = false;
      final speech = service(tester, phone), socket = transport.Socket();
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('speechStart');
      phone.emit('partial', text: 'unconfirmed draft');
      phone.emit('error', code: 2);
      await tester.pump();
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(seconds: 1));
        await tester.pump();
        await tester.pump(const Duration(seconds: 4));
        await tester.pump();
      }
      expect(socket.sent, isEmpty);
      expect(p.recoveryAttempt, 3);
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.isListening, isFalse);
      expect(p.partialTranscript, 'unconfirmed draft');
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
}
