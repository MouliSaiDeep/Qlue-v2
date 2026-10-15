import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/shared/services/platform_speech_source.dart';
import 'package:frontend/shared/services/stt_service.dart';

class PhoneSpeech extends PlatformSpeechSource {
  final controller = StreamController<Map<String, dynamic>>.broadcast(
    sync: true,
  );
  int epoch = 0, starts = 0, cancels = 0;
  bool autoReady = true, finishOnStop = true;
  String draft = '';
  @override
  Stream<Map<String, dynamic>> get events => controller.stream;
  @override
  Future<bool> initialize() async => true;
  @override
  Future<void> start(int value) async {
    epoch = value;
    draft = '';
    starts++;
    if (autoReady) emit('ready');
  }

  void emit(String type, {String? text, int? oldEpoch, int? code}) {
    if ((oldEpoch == null || oldEpoch == epoch) &&
        (type == 'partial' || type == 'final')) {
      draft = text ?? '';
    }
    controller.add({
      'epoch': oldEpoch ?? epoch,
      'type': type,
      'text': text,
      'code': code,
    });
  }

  @override
  Future<void> stop(int value) async {
    if (value == epoch && finishOnStop) {
      emit('final', text: draft);
      emit('done');
    }
  }

  @override
  Future<void> cancel(int value) async {
    if (value == epoch) cancels++;
  }
}

void main() {
  testWidgets(
    'stable plugin hypotheses replace, final is authoritative and immediate',
    (tester) async {
      final phone = PhoneSpeech(), partials = <String>[], finals = <String>[];
      final stt = SttService(source: phone);
      await stt.startListening(onPartial: partials.add, onFinal: finals.add);
      phone.emit('partial', text: 'we use flitter');
      phone.emit('partial', text: 'we we use Flutter');
      phone.emit('final', text: 'we we use Flutter again');
      expect(partials, ['we use flitter', 'we we use Flutter']);
      expect(finals, ['we we use Flutter again']);
      phone.emit('final', text: 'duplicate');
      expect(finals, hasLength(1));
      stt.dispose();
      await tester.pump();
      await phone.controller.close();
    },
  );
  testWidgets('no custom endpoint or automatic utterance restart runs', (
    tester,
  ) async {
    final phone = PhoneSpeech();
    final owned = SttService(source: phone);
    var endpoints = 0;
    owned.configureCapture(
      identity: 'q',
      preserve: false,
      onActivity: (_) {},
      onEndpoint: () => endpoints++,
    );
    await owned.startListening(onPartial: (_) {}, onFinal: (_) {});
    phone.emit('speechEnd');
    await tester.pump(const Duration(seconds: 16));
    expect(endpoints, 0);
    expect(phone.starts, 1);
    owned.dispose();
    await tester.pump();
    await phone.controller.close();
  });
  testWidgets('cancel, next question and dispose fence old plugin results', (
    tester,
  ) async {
    final phone = PhoneSpeech(), finals = <String>[];
    final stt = SttService(source: phone);
    await stt.startListening(onPartial: (_) {}, onFinal: finals.add);
    final old = phone.epoch;
    await stt.stopCapture();
    phone.emit('final', text: 'cancelled');
    await stt.startListening(onPartial: (_) {}, onFinal: finals.add);
    phone.emit('final', text: 'previous question', oldEpoch: old);
    expect(finals, isEmpty);
    phone.emit('final', text: 'current');
    expect(finals, ['current']);
    stt.dispose();
    phone.emit('final', text: 'disposed');
    await tester.pump();
    await phone.controller.close();
  });
  testWidgets('recognizer failure and status use the current callback owner', (
    tester,
  ) async {
    final phone = PhoneSpeech(), errors = <String>[], statuses = <String>[];
    final stt = SttService(source: phone);
    await stt.startListening(
      onPartial: (_) {},
      onFinal: (_) {},
      onError: (e) => errors.add(e.errorMsg),
      onStatus: statuses.add,
    );
    phone.emit('error', text: 'error_network');
    phone.emit('done');
    expect(errors, ['error_network']);
    expect(statuses, ['listening', 'done']);
    stt.dispose();
    await tester.pump();
    await phone.controller.close();
  });
}
