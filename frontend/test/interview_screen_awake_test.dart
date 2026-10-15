import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/shared/services/screen_awake_service.dart';
import 'package:frontend/screens/interview/interview_screen_awake.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'account_isolation_test.dart' as fixture;
import 'interview_reconnect_contract_test.dart' as reconnect;
import 'interview_replay_test.dart' as replay;

class AwakePort implements ScreenAwakePlatform {
  bool active = false, fail = false;
  final calls = <bool>[];
  Completer<void>? enableGate;
  @override
  Future<void> setEnabled(bool value) async {
    calls.add(value);
    if (fail) throw StateError('platform unavailable');
    if (value) await enableGate?.future;
    active = value;
  }

  @override
  Future<bool> get enabled async => active;
}

void main() {
  testWidgets('delayed enable reconciles to off after the route owner leaves', (
    tester,
  ) async {
    final port = AwakePort()..enableGate = Completer<void>();
    final service = ScreenAwakeService(platform: port);
    final owner = Object();
    service.update(owner, true);
    await tester.pump();
    service.release(owner);
    port.enableGate!.complete();
    await tester.pump();
    await service.settled;
    expect(port.active, isFalse);
    expect(port.calls, [true, false]);
  });
  testWidgets(
    'old cleanup cannot disable a newer owner; a late timed-out enable is compensated',
    (tester) async {
      final port = AwakePort()..enableGate = Completer<void>();
      final service = ScreenAwakeService(platform: port);
      final old = Object(), next = Object();
      service.update(old, true);
      await tester.pump();
      service.update(next, true);
      service.release(old);
      port.enableGate!.complete();
      await tester.pump();
      await service.settled;
      expect(port.active, isTrue);
      port.enableGate = Completer<void>();
      service.update(next, true, force: true);
      await tester.pump();
      await tester.pump(const Duration(seconds: 5));
      expect(service.protected, isFalse);
      service.release(next);
      await tester.pump();
      expect(port.active, isFalse);
      port.enableGate!.complete();
      await tester.pump();
      await service.settled;
      expect(port.active, isFalse);
    },
  );
  testWidgets(
    'visible foreground playback/listening/processing/reconnect keep awake; all lifecycle exits release',
    (tester) async {
      final port = AwakePort();
      final awake = ScreenAwakeService(platform: port);
      final socket = reconnect.Socket(),
          audio = replay.ReplayAudio()..gate = Completer<void>();
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: audio,
      )..debugAttachSocket(socket, 's');
      await tester.pumpWidget(
        MaterialApp(
          navigatorObservers: [interviewRouteObserver],
          home: InterviewScreenAwake(
            provider: p,
            service: awake,
            child: const Scaffold(body: Text('interview')),
          ),
        ),
      );
      socket.question('q0', 0);
      await tester.pump();
      expect(port.active, isTrue);
      audio.gate!.complete();
      await tester.pump();
      expect(p.isListening, isTrue);
      expect(port.active, isTrue);
      await p.submitTypedAnswer('answer');
      await tester.pump();
      expect(port.active, isTrue);
      socket.drops.add(null);
      await tester.pump();
      expect(port.active, isTrue);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(port.active, isFalse);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(port.active, isTrue);
      p.resetForUser(null);
      await tester.pump();
      expect(port.active, isFalse);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      expect(port.active, isFalse);
      p.dispose();
      socket.dispose();
      awake.dispose();
    },
  );
  testWidgets(
    'navigation hides capture and wake protection, returning reapplies; terminal failure releases',
    (tester) async {
      final port = AwakePort();
      final awake = ScreenAwakeService(platform: port),
          socket = reconnect.Socket();
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(socket, 's');
      await tester.pumpWidget(
        MaterialApp(
          navigatorObservers: [interviewRouteObserver],
          home: InterviewScreenAwake(
            provider: p,
            service: awake,
            child: const Scaffold(body: Text('interview')),
          ),
        ),
      );
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      expect(port.active, isTrue);
      final navigator = tester.state<NavigatorState>(find.byType(Navigator));
      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('other')),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(port.active, isFalse);
      expect(p.isListening, isFalse);
      final sentBefore = socket.sent.length;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(port.active, isFalse);
      expect(p.isListening, isFalse);
      expect(socket.sent.length, sentBefore);
      navigator.pop();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(port.active, isTrue);
      socket.events.add({
        'type': 'turn_error',
        'payload': {'terminal': true, 'error': 'stopped'},
      });
      await tester.pump();
      expect(port.active, isFalse);
      await tester.pumpWidget(const SizedBox());
      p.dispose();
      socket.dispose();
      awake.dispose();
    },
  );
  testWidgets('platform failure is visible and never claims protection', (
    tester,
  ) async {
    final port = AwakePort()..fail = true;
    final service = ScreenAwakeService(platform: port);
    final p = InterviewProvider(
      sttService: fixture.FakeStt(),
      ttsService: fixture.FakeTts(),
    )..debugAttachSocket(reconnect.Socket(), 's');
    await tester.pumpWidget(
      MaterialApp(
        home: InterviewScreenAwake(
          provider: p,
          service: service,
          child: const Scaffold(),
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('screen-awake-error')), findsOneWidget);
    expect(service.protected, isFalse);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    p.dispose();
  });
  for (final exit in [
    'end',
    'termination',
    'initialization-failure',
    'exhaustion',
  ]) {
    testWidgets('$exit releases protection immediately', (tester) async {
      final port = AwakePort(),
          socket = reconnect.Socket(),
          audio = replay.ReplayAudio()..gate = Completer<void>();
      final awake = ScreenAwakeService(platform: port);
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: audio,
      )..debugAttachSocket(socket, 's');
      await tester.pumpWidget(
        MaterialApp(
          home: InterviewScreenAwake(
            provider: p,
            service: awake,
            child: const Scaffold(),
          ),
        ),
      );
      await tester.pump();
      expect(port.active, isTrue);
      Future<void>? ending;
      switch (exit) {
        case 'end':
          ending = p.endSession();
        case 'termination':
          socket.events.add({
            'type': 'termination',
            'payload': {'sessionId': 's'},
          });
        case 'initialization-failure':
          p.microphoneAvailable = false;
          p.debugStartListening();
        case 'exhaustion':
          socket.events.add({
            'type': 'turn_error',
            'payload': {'terminal': true, 'error': 'TURN_RECOVERY_EXHAUSTED'},
          });
      }
      await tester.pump();
      expect(port.active, isFalse);
      audio.gate!.complete();
      await tester.pump(const Duration(seconds: 1));
      if (ending != null) await ending;
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      p.dispose();
      socket.dispose();
      awake.dispose();
    });
  }
  testWidgets(
    'replacing an old route while its enable is delayed retains the new route lease',
    (tester) async {
      final port = AwakePort()..enableGate = Completer<void>();
      final service = ScreenAwakeService(platform: port),
          oldSocket = reconnect.Socket(),
          nextSocket = reconnect.Socket();
      final old = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(oldSocket, 's');
      final next = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: fixture.FakeTts(),
      )..debugAttachSocket(nextSocket, 's');
      await tester.pumpWidget(
        MaterialApp(
          home: InterviewScreenAwake(
            key: const Key('old'),
            provider: old,
            service: service,
            child: const Scaffold(),
          ),
        ),
      );
      await tester.pump();
      await tester.pumpWidget(
        MaterialApp(
          home: InterviewScreenAwake(
            key: const Key('next'),
            provider: next,
            service: service,
            child: const Scaffold(),
          ),
        ),
      );
      port.enableGate!.complete();
      await tester.pump();
      await service.settled;
      expect(port.active, isTrue);
      expect(next.needsScreenAwake, isTrue);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      await service.settled;
      expect(port.active, isFalse);
      old.dispose();
      next.dispose();
      oldSocket.dispose();
      nextSocket.dispose();
      service.dispose();
    },
  );
}
