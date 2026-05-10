import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/context/auth_provider.dart';

void main() {
  group('AuthProvider Tests', () {
    test('initial state should be unauthenticated and initializing', () {
      final authProvider = AuthProvider();
      expect(authProvider.isAuthenticated, false);
      expect(authProvider.isInitializing, true);
    });

    test('voice selection should update state', () async {
      final authProvider = AuthProvider();
      // AuthProvider uses updateUserProfile for state updates
      await authProvider.updateUserProfile(voiceId: 'Matthew');
      expect(authProvider.voiceId, 'Matthew');
    });
  });
}
