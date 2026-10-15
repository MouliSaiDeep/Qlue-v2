import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'account_isolation_test.dart' as fixture;

class FragmentSocket extends fixture.FakeWs {
  final incoming = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Stream<Map<String, dynamic>> get messages => incoming.stream;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('fragment exhaustion explains termination and releases capture', (
    tester,
  ) async {
    final mic = fixture.FakeStt();
    final socket = FragmentSocket();
    final p = InterviewProvider(sttService: mic, ttsService: fixture.FakeTts());
    p.debugAttachSocket(socket, 'fragment-session');
    p.debugStartListening();
    socket.incoming.add({
      'type': 'termination',
      'payload': {
        'sessionId': 'fragment-session',
        'reason': 'RECOGNITION_RECOVERY_LIMIT',
      },
    });
    await tester.pump();
    expect(p.isSessionEnded, true);
    expect(p.errorMessage, contains('only fragments'));
    expect(mic.isListening, false);
    expect(p.needsScreenAwake, false);
    p.resetForNewSession();
    expect(p.errorMessage, isNull);
    p.dispose();
    await socket.incoming.close();
  });
}
