import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';

class MockInterviewProvider extends Mock implements InterviewProvider {}

void main() {
  // InterviewProvider's constructor registers a platform method-call handler,
  // which requires the test binding to be initialized first.
  TestWidgetsFlutterBinding.ensureInitialized();

  group('InterviewProvider Tests', () {
    test('initial state should be correct', () {
      final provider = InterviewProvider();
      expect(provider.sessionId, isNull);
      expect(provider.isConnecting, false);
      expect(provider.isSessionEnded, false);
    });

    test('initSession should exist', () {
      final provider = InterviewProvider();
      expect(provider.initSession, isNotNull);
    });
  });
}
