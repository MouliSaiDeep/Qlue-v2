import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/shared/services/system_speech_stt_service.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'platform_speech_capture_test.dart' show PhoneSpeech;
import 'account_isolation_test.dart' as fixture;
import 'interview_reconnect_contract_test.dart' as transport;

// Native Android ends a stop on an idle listen with ERROR_NO_MATCH or
// ERROR_SPEECH_TIMEOUT. The adapter emits done, with no fabricated final text.
class IdlePhoneSpeech extends PhoneSpeech {
  int idleStops = 0;
  @override
  Future<void> stop(int value) async {
    if (value == epoch && draft.isEmpty) {
      idleStops++;
      emit('done');
    } else {
      await super.stop(value);
    }
  }
}

SystemSpeechSttService service(WidgetTester tester, PhoneSpeech phone) {
  final origin = tester.binding.clock.now();
  return SystemSpeechSttService(
    source: phone,
    elapsed: () => tester.binding.clock.now().difference(origin),
  );
}

void main() {
  testWidgets(
    'segmented native finals preserve all three phrases in one listener and submit only after four seconds',
    (tester) async {
      final phone = PhoneSpeech(), socket = transport.Socket();
      final speech = service(tester, phone);
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      final epoch = phone.epoch;
      final phrases = [
        'my name is Rishi',
        'I am pursuing my final year at Aditya College',
        'I enjoy software development and practical projects',
      ];
      for (var i = 0; i < phrases.length; i++) {
        phone.emit('speechStart');
        phone.emit('partial', text: 'unfinished hypothesis');
        phone.emit('speechEnd');
        phone.emit('segmentFinal', text: phrases[i]);
        await tester.pump();
        expect(phone.epoch, epoch);
        expect(p.partialTranscript, phrases.take(i + 1).join(' '));
        if (i < 2) {
          await tester.pump(Duration(seconds: i == 0 ? 2 : 1));
          expect(socket.sent, isEmpty);
        }
      }
      await tester.pump(const Duration(milliseconds: 3999));
      expect(socket.sent, isEmpty);
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      expect(
        socket.sent.single['payload']['textTranscript'],
        phrases.join(' '),
      );
      expect(p.recoveryAttempt, 0);
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets(
    'empty NO_MATCH after native speech-start preserves the initial thinking window without recovery',
    (tester) async {
      final phone = IdlePhoneSpeech(), socket = transport.Socket();
      final speech = service(tester, phone);
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));
      phone.emit('speechStart');
      phone.emit('error', code: 7);
      await tester.pump();
      await tester.pump();
      expect(p.recoveryAttempt, 0);
      expect(socket.sent, isEmpty);
      await tester.pump(const Duration(seconds: 10));
      await tester.pump();
      expect(socket.sent.single['payload']['isSilence'], isTrue);
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets(
    'empty no-match after a completed phrase retains the answer and quiet window',
    (tester) async {
      final phone = IdlePhoneSpeech(), socket = transport.Socket();
      final speech = service(tester, phone);
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('speechStart');
      phone.emit('speechEnd');
      phone.emit('final', text: 'my full introduction');
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
      phone.emit('speechStart');
      phone.emit('noMatch', code: 7);
      await tester.pump();
      await tester.pump();
      expect(p.partialTranscript, 'my full introduction');
      expect(p.recoveryAttempt, 0);
      await tester.pump(const Duration(seconds: 2));
      await tester.pump();
      expect(
        socket.sent.single['payload']['textTranscript'],
        'my full introduction',
      );
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets(
    'no-match with an unfinished hypothesis remains a real finalization failure',
    (tester) async {
      final phone = PhoneSpeech();
      final actual = service(tester, phone), errors = <String>[];
      await actual.startListening(
        onPartial: (_) {},
        onFinal: (_) {},
        onError: (e) => errors.add(e.errorMsg),
      );
      phone.emit('speechStart');
      phone.emit('partial', text: 'unfinished words');
      phone.emit('error', code: 7);
      expect(errors, ['speech_final_missing']);
      actual.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets(
    'idle native no-match after a finalized answer submits once without microphone recovery',
    (tester) async {
      final phone = IdlePhoneSpeech(), socket = transport.Socket();
      final speech = service(tester, phone);
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('speechStart');
      phone.emit('speechEnd');
      phone.emit('final', text: 'my complete introduction');
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(seconds: 4));
      await tester.pump();
      expect(
        socket.sent.where((m) => m['type'] == 'turn_submit'),
        hasLength(1),
      );
      expect(
        socket.sent.single['payload']['textTranscript'],
        'my complete introduction',
      );
      expect(phone.idleStops, 0);
      expect(p.recoveryAttempt, 0);
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets(
    'initial no-answer silence cancels idle native listener without requiring a final',
    (tester) async {
      final phone = IdlePhoneSpeech(), socket = transport.Socket();
      final speech = service(tester, phone);
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      expect(
        socket.sent.where((m) => m['type'] == 'turn_submit'),
        hasLength(1),
      );
      expect(socket.sent.single['payload']['isSilence'], isTrue);
      expect(socket.sent.single['payload']['textTranscript'], isEmpty);
      expect(phone.idleStops, 0);
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets(
    'Rishi introduction keeps earlier utterance and replaces only current hypothesis',
    (tester) async {
      final phone = PhoneSpeech(), socket = transport.Socket();
      final speech = service(tester, phone);
      final p = InterviewProvider(
        sttService: speech,
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      phone.emit('speechStart');
      phone.emit('partial', text: 'my name is risky');
      phone.emit('speechEnd');
      phone.emit('final', text: 'my name is Rishi');
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      phone.emit('speechStart');
      phone.emit('partial', text: "I'm currently pursuing BTech");
      phone.emit(
        'partial',
        text:
            "I'm currently pursuing BTech final year at Aditya College of Engineering and Technology",
      );
      expect(
        p.partialTranscript,
        "my name is Rishi I'm currently pursuing BTech final year at Aditya College of Engineering and Technology",
      );
      phone.emit('speechEnd');
      phone.emit(
        'final',
        text:
            "I'm currently pursuing BTech final year at Aditya College of Engineering and Technology",
      );
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 3999));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      expect(
        socket.sent.single['payload']['textTranscript'],
        "my name is Rishi I'm currently pursuing BTech final year at Aditya College of Engineering and Technology",
      );
      phone.emit('final', text: 'obsolete');
      expect(socket.sent, hasLength(1));
      p.dispose();
      socket.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );

  testWidgets(
    'native silence clock excludes restart downtime and ignores changing text',
    (tester) async {
      final phone = PhoneSpeech();
      final actual = service(tester, phone);
      var endpoints = 0;
      actual.configureCapture(
        identity: 'q',
        preserve: false,
        onActivity: (_) {},
        onEndpoint: () => endpoints++,
      );
      await actual.startListening(onPartial: (_) {}, onFinal: (_) {});
      phone.emit('speechStart');
      phone.emit('partial', text: 'first part');
      await tester.pump(const Duration(seconds: 45));
      expect(endpoints, 0);
      phone.emit('speechEnd');
      await tester.pump(const Duration(seconds: 2));
      phone.autoReady = false;
      phone.emit('final', text: 'first part');
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));
      expect(endpoints, 0);
      phone.emit('ready');
      await tester.pump(const Duration(milliseconds: 1999));
      expect(endpoints, 0);
      phone.emit('partial', text: '');
      await tester.pump(const Duration(milliseconds: 1));
      expect(endpoints, 1);
      actual.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );

  testWidgets(
    'empty final fails without erasing interrupted draft or submitting it',
    (tester) async {
      final phone = PhoneSpeech();
      final speech = service(tester, phone),
          partials = <String>[],
          errors = <String>[];
      await speech.startListening(
        onPartial: partials.add,
        onFinal: (_) {},
        onError: (e) => errors.add(e.errorMsg),
      );
      phone.emit('speechStart');
      phone.emit('partial', text: 'retained introduction');
      phone.emit('final', text: '');
      expect(errors, ['speech_final_empty']);
      await speech.stopCapture();
      await speech.startListening(onPartial: partials.add, onFinal: (_) {});
      phone.emit('speechStart');
      phone.emit('partial', text: 'continued introduction');
      expect(partials.last, 'retained introduction continued introduction');
      speech.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );

  testWidgets(
    'flush waits for authoritative final and times out without submitting a partial',
    (tester) async {
      final phone = PhoneSpeech()..finishOnStop = false;
      final speech = service(tester, phone), finals = <String>[];
      await speech.startListening(onPartial: (_) {}, onFinal: finals.add);
      phone.emit('speechStart');
      phone.emit('partial', text: 'unfinished hypothesis');
      final pending = speech.stopCaptureAndFlush();
      final assertion = expectLater(pending, throwsA(isA<TimeoutException>()));
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));
      await assertion;
      expect(finals, isEmpty);
      speech.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );

  testWidgets(
    'new question and disposal fence old native results and silence timers',
    (tester) async {
      final phone = PhoneSpeech();
      final actual = service(tester, phone), results = <String>[];
      var endpoints = 0;
      actual.configureCapture(
        identity: 'q1',
        preserve: false,
        onActivity: (_) {},
        onEndpoint: () => endpoints++,
      );
      await actual.startListening(onPartial: results.add, onFinal: results.add);
      final old = phone.epoch;
      phone.emit('speechStart');
      phone.emit('speechEnd');
      actual.configureCapture(
        identity: 'q2',
        preserve: false,
        onActivity: (_) {},
        onEndpoint: () => endpoints++,
      );
      await actual.startListening(onPartial: results.add, onFinal: results.add);
      phone.emit('final', text: 'old question', oldEpoch: old);
      await tester.pump(const Duration(seconds: 4));
      expect(endpoints, 0);
      expect(results, isEmpty);
      actual.dispose();
      await tester.pump(const Duration(seconds: 20));
      expect(endpoints, 0);
      await phone.controller.close();
    },
  );
}
