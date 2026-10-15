import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
import 'package:mocktail/mocktail.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:frontend/core/network/websocket_client.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'account_isolation_test.dart' as fixture;
import 'interview_reconnect_contract_test.dart' as reconnect;

class FailingAudio extends fixture.FakeTts {
  int attempts = 0;
  @override
  Future<void> playUrl(String url) async {
    attempts++;
    throw StateError('audio unavailable');
  }
}

class ConnectedSocket extends reconnect.Socket {
  int authRefreshes = 0;
  int connectCalls = 0;
  @override
  Future<void> connect({String? authToken}) async {
    connectCalls++;
  }

  @override
  bool get isConnected => true;
  @override
  void refreshAuthentication() {
    authRefreshes++;
    drops.add(null);
  }
}

class MockChannel extends Mock implements WebSocketChannel {}

class MockSink extends Mock implements WebSocketSink {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'expired socket authentication requests a fresh connection with the draft intact',
    (tester) async {
      final socket = ConnectedSocket();
      final auth = fixture.MockFirebaseAuth(), user = fixture.MockUser();
      when(() => auth.currentUser).thenReturn(user);
      when(() => user.uid).thenReturn('u');
      when(
        () => user.getIdToken(true),
      ).thenAnswer((_) async => 'refreshed-token');
      final p = InterviewProvider(
        auth: auth,
        sttService: fixture.FakeStt(),
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      p.debugStartListening();
      await p.submitTypedAnswer('saved');
      final original = socket.sent.single['payload'];
      socket.events.add({
        'type': 'turn_error',
        'payload': {'code': 401, 'error': 'Session expired'},
      });
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
      await tester.pump();
      expect(socket.connectCalls, 1);
      expect(p.hasPendingAnswer, isTrue);
      expect(p.isSessionEnded, isFalse);
      socket.resumes.add(null);
      await tester.pump();
      socket.events.add({
        'type': 'reconnect_ack',
        'payload': {'sessionId': 's'},
      });
      await tester.pump();
      expect(socket.sent.last['payload'], original);
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'background pause preserves draft and resumes automatically without a silence submission',
    (tester) async {
      final socket = ConnectedSocket(), mic = fixture.FakeStt();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onPartialCb!('before pause');
      p.handleLifecycleState(AppLifecycleState.paused);
      await tester.pump(const Duration(seconds: 30));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit'), isEmpty);
      expect(mic.isListening, isFalse);
      p.handleLifecycleState(AppLifecycleState.resumed);
      expect(socket.sent.last['type'], 'session_reconnect');
      socket.question('q0', 0);
      await tester.pump();
      mic.onPartialCb!('after resume');
      await tester.pump(InterviewProvider.silenceDuration);
      await tester.pump();
      expect(p.transcript.last.text, 'before pause after resume');
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets('transport retries exactly three times after initial failure', (
    tester,
  ) async {
    var connections = 0;
    final retries = <int>[];
    var exhausted = 0;
    final socket = WebSocketClient(
      url: 'wss://test',
      userId: 'u',
      sessionId: 's',
      tokenProvider: () async => 'test-token',
      channelFactory: (_) {
        connections++;
        throw StateError('offline');
      },
    );
    socket.retryCounts.listen(retries.add);
    socket.reconnectExhausted.listen((_) => exhausted++);
    await expectLater(
      socket.connect(authToken: 'test-token'),
      throwsStateError,
    );
    for (final seconds in [2, 4, 6]) {
      await tester.pump(Duration(seconds: seconds));
      await tester.pump();
    }
    await tester.pump(const Duration(seconds: 60));
    expect(connections, 4);
    expect(retries, [1, 2, 3]);
    expect(exhausted, 1);
    socket.dispose();
  });

  testWidgets('intentional disconnect cancels an outstanding transport retry', (
    tester,
  ) async {
    var connections = 0;
    final socket = WebSocketClient(
      url: 'wss://test',
      userId: 'u',
      sessionId: 's',
      tokenProvider: () async => 'test-token',
      channelFactory: (_) {
        connections++;
        throw StateError('offline');
      },
    );
    await expectLater(socket.connect(), throwsStateError);
    socket.disconnect();
    await tester.pump(const Duration(seconds: 30));
    expect(connections, 1);
    socket.dispose();
  });

  testWidgets(
    'successful handshakes followed by drops do not reset the three-retry budget',
    (tester) async {
      final streams = <StreamController<dynamic>>[];
      var attempts = 0, exhausted = 0;
      final socket = WebSocketClient(
        url: 'wss://test',
        userId: 'u',
        sessionId: 's',
        tokenProvider: () async => 'token',
        channelFactory: (_) {
          attempts++;
          final channel = MockChannel(),
              sink = MockSink(),
              stream = StreamController<dynamic>();
          streams.add(stream);
          when(() => channel.ready).thenAnswer((_) async {});
          when(() => channel.stream).thenAnswer((_) => stream.stream);
          when(() => channel.sink).thenReturn(sink);
          when(() => sink.close()).thenAnswer((_) async {});
          when(() => sink.close(1000)).thenAnswer((_) async {});
          return channel;
        },
      );
      socket.reconnectExhausted.listen((_) => exhausted++);
      await socket.connect(authToken: 'token');
      for (final delay in [2, 4, 6]) {
        await streams.last.close();
        await tester.pump();
        await tester.pump(Duration(seconds: delay));
        await tester.pump();
        expect(socket.isConnected, isTrue);
      }
      await streams.last.close();
      await tester.pump();
      await tester.pump(const Duration(seconds: 60));
      expect(attempts, 4);
      expect(exhausted, 1);
      await expectLater(socket.connect(authToken: 'token'), throwsStateError);
      expect(attempts, 4);
      socket.dispose();
    },
  );

  testWidgets(
    'turn errors retry saved payload three times without duplicating the transcript',
    (tester) async {
      final socket = reconnect.Socket();
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      p.debugStartListening();
      await p.submitTypedAnswer('saved answer');
      final original = Map<String, dynamic>.from(socket.sent.single['payload']);
      for (var i = 1; i <= 3; i++) {
        socket.events.add({
          'type': 'turn_error',
          'payload': {'sessionId': 's', 'error': 'temporary failure'},
        });
        await tester.pump();
        await tester.pump(const Duration(seconds: 2));
        expect(p.recoveryAttempt, i);
        expect(
          socket.sent.where((m) => m['type'] == 'turn_submit').length,
          i + 1,
        );
        expect(socket.sent.last['payload'], original);
      }
      socket.events.add({
        'type': 'turn_error',
        'payload': {'error': 'temporary failure'},
      });
      await tester.pump();
      await tester.pump(const Duration(seconds: 60));
      expect(p.currentPhase, InterviewPhase.error);
      expect(p.hasPendingAnswer, isTrue);
      expect(socket.sent.length, 4);
      expect(p.transcript.length, 1);
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'late success cancels automatic answer retry and next question starts empty',
    (tester) async {
      final socket = reconnect.Socket();
      final mic = fixture.FakeStt();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onPartialCb!('first answer');
      final old = mic.onPartialCb!;
      await tester.pump(InterviewProvider.silenceDuration);
      await tester.pump();
      socket.events.add({
        'type': 'turn_error',
        'payload': {'error': 'temporary'},
      });
      await tester.pump();
      socket.question('q1', 1);
      await tester.pump();
      await tester.pump();
      old('old answer');
      await tester.pump(const Duration(seconds: 2));
      expect(socket.sent.where((m) => m['type'] == 'turn_submit').length, 1);
      expect(p.partialTranscript, isEmpty);
      mic.onPartialCb!('second answer');
      await tester.pump(InterviewProvider.silenceDuration);
      await tester.pump();
      final answers = socket.sent
          .where((m) => m['type'] == 'turn_submit')
          .map((m) => m['payload'])
          .toList();
      expect(answers.map((a) => a['textTranscript']), [
        'first answer',
        'second answer',
      ]);
      expect(answers[0]['clientTurnId'], isNot(answers[1]['clientTurnId']));
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'reconnect ack followed by duplicate question restores listening and draft',
    (tester) async {
      final socket = reconnect.Socket(), mic = fixture.FakeStt();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onPartialCb!('draft');
      socket.drops.add(null);
      await tester.pump();
      socket.resumes.add(null);
      await tester.pump();
      socket.events.add({
        'type': 'reconnect_ack',
        'payload': {'sessionId': 's'},
      });
      await tester.pump();
      socket.question('q0', 0);
      await tester.pump();
      expect(p.isListening, isTrue);
      expect(p.partialTranscript, 'draft');
      p.dispose();
      socket.dispose();
    },
  );

  testWidgets(
    'audio retries three times then presents text and opens microphone automatically',
    (tester) async {
      final socket = reconnect.Socket(), audio = FailingAudio();
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: audio,
      );
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(seconds: 1));
        await tester.pump();
      }
      expect(audio.attempts, 4);
      expect(p.isListening, isTrue);
      expect(p.errorMessage, contains('Read the question'));
      p.dispose();
      socket.dispose();
    },
  );
}
