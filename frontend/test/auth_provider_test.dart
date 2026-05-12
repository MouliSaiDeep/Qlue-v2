import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:frontend/context/auth_provider.dart';

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  group('AuthProvider Tests', () {
    test('initial state should be unauthenticated', () {
      final authProvider = AuthProvider();
      expect(authProvider.isAuthenticated, false);
      expect(authProvider.isInitializing, true);
    });

    test('login method should exist', () {
      final authProvider = AuthProvider();
      expect(authProvider.login, isNotNull);
    });
  });
}
