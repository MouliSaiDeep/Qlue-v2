import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/network/websocket_client.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/screens/interview/interview_recovery_controls.dart';
import 'account_isolation_test.dart' as fixture;

class Socket extends WebSocketClient {
  Socket() : super(url: 'wss://fake', userId: 'u', sessionId: 's');
  @override
  bool get isConnected => true;
  final events = StreamController<Map<String, dynamic>>.broadcast();
  final drops = StreamController<void>.broadcast();
  final resumes = StreamController<void>.broadcast();
  final List<Map<String, dynamic>> sent = [];
  @override
  Stream<Map<String, dynamic>> get messages => events.stream;
  @override
  Stream<void> get disconnects => drops.stream;
  @override
  Stream<void> get reconnects => resumes.stream;
  @override
  void sendMessage(Map<String, dynamic> message) => sent.add(message);
  void question(String id, int index, {String? clientId}) => events.add({
    'type': 'turn_complete',
    'payload': {
      'sessionId': 's',
      'turnId': id,
      'turnIndex': index,
      'clientTurnId': clientId,
      'questionText': 'A complete question?',
      'expectsAnswer': true,
      'audioUrl': 'https://audio',
    },
  });
  @override
  void dispose() {
    events.close();
    drops.close();
    resumes.close();
    super.dispose();
  }
}

class Audio extends fixture.FakeTts {
  Completer<void>? gate;
  int stops = 0;
  @override
  Future<void> playUrl(String url) async {
    await gate?.future;
  }

  @override
  Future<void> stop() async {
    stops++;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'listening interruption retains draft and resumes one capture without completion navigation',
    (tester) async {
      final mic = fixture.FakeStt(), socket = Socket();
      final p = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      await tester.pump();
      mic.onPartialCb!('before network drop');
      final obsolete = mic.onFinalCb!;
      socket.drops.add(null);
      await tester.pump();
      expect(p.currentPhase, InterviewPhase.reconnecting);
      expect(p.isSessionEnded, isFalse);
      expect(mic.isListening, isFalse);
      obsolete('obsolete');
      socket.resumes.add(null);
      await tester.pump();
      expect(socket.sent.last['type'], 'session_reconnect');
      socket.question('q0', 0);
      await tester.pump();
      mic.onPartialCb!('after reconnect');
      await p.doneSpeaking();
      expect(p.transcript.last.text, 'before network drop after reconnect');
      expect(socket.sent.where((m) => m['type'] == 'turn_submit').length, 1);
      p.dispose();
    },
  );
  testWidgets(
    'generation interruption resends an unacknowledged answer with its original identity',
    (tester) async {
      final socket = Socket();
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: fixture.FakeTts(),
      );
      p.debugAttachSocket(socket, 's');
      p.debugStartListening();
      await p.submitTypedAnswer('saved answer');
      final original = Map<String, dynamic>.from(socket.sent.last['payload']);
      socket.drops.add(null);
      await tester.pump();
      socket.resumes.add(null);
      await tester.pump();
      socket.events.add({
        'type': 'reconnect_ack',
        'payload': {'sessionId': 's', 'state': 'USER_RESPONDING'},
      });
      await tester.pump();
      final submissions = socket.sent
          .where((m) => m['type'] == 'turn_submit')
          .toList();
      expect(submissions.length, 2);
      expect(submissions.last['payload'], original);
      expect(p.isSessionEnded, isFalse);
      socket.question('q1', 1, clientId: original['clientTurnId']);
      await tester.pump();
      await tester.pump();
      expect(p.hasPendingAnswer, isFalse);
      expect(p.transcript.where((e) => e.role == 'USER').length, 1);
      p.dispose();
    },
  );
  testWidgets(
    'playback interruption stops audio; late tokens and completion cannot restart obsolete playback',
    (tester) async {
      final socket = Socket(), audio = Audio()..gate = Completer<void>();
      final mic = fixture.FakeStt();
      final p = InterviewProvider(sttService: mic, ttsService: audio);
      p.debugAttachSocket(socket, 's');
      socket.question('q0', 0);
      await tester.pump();
      expect(p.currentPhase, InterviewPhase.speaking);
      socket.drops.add(null);
      await tester.pump();
      audio.gate!.complete();
      await tester.pump();
      expect(p.currentPhase, InterviewPhase.reconnecting);
      expect(mic.isListening, isFalse);
      expect(audio.stops, greaterThan(0));
      socket.question('q0', 0);
      await tester.pump();
      socket.events.add({
        'type': 'text_stream',
        'payload': {
          'sessionId': 's',
          'turnId': 'q0',
          'turnIndex': 0,
          'sequence': 3,
          'fullText': 'late',
        },
      });
      await tester.pump();
      expect(p.currentPhase, InterviewPhase.listening);
      expect(p.currentQuestion, 'A complete question?');
      expect(p.transcript.length, 1);
      p.dispose();
    },
  );
  testWidgets(
    'denied microphone and 409/429 messages render actionable recovery controls',
    (tester) async {
      final p = InterviewProvider(
        sttService: fixture.FakeStt(),
        ttsService: fixture.FakeTts(),
      );
      p.microphoneAvailable = false;
      p.errorMessage = 'Daily interview limit reached. It resets tomorrow.';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: InterviewRecoveryControls(provider: p)),
        ),
      );
      expect(find.textContaining('resets tomorrow'), findsOneWidget);
      expect(find.byType(TextButton), findsNothing);
      p.errorMessage = 'Another interview is active. Resume it.';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: InterviewRecoveryControls(provider: p)),
        ),
      );
      expect(find.byType(TextButton), findsNothing);
      p.dispose();
    },
  );
}
