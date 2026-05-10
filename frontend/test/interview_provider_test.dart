import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';

void main() {
  group('InterviewProvider Tests', () {
    test('initial state should be idle', () {
      final provider = InterviewProvider();
      expect(provider.isConnecting, false);
      expect(provider.sessionId, null);
    });

    test('resetForNewSession should clear state', () {
      final provider = InterviewProvider();
      provider.resetForNewSession();
      expect(provider.currentPhase, InterviewPhase.ready);
      expect(provider.isConnecting, true);
    });
  });
}
