import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:frontend/context/auth_provider.dart';

// Inject a mock FirebaseAuth so AuthProvider can be constructed without the
// Firebase platform being initialized.
class MockFirebaseAuth extends Mock implements FirebaseAuth {}

void main() {
  late MockFirebaseAuth mockAuth;

  setUp(() {
    mockAuth = MockFirebaseAuth();
    when(() => mockAuth.currentUser).thenReturn(null);
    when(() => mockAuth.authStateChanges())
        .thenAnswer((_) => const Stream<User?>.empty());
  });

  group('AuthProvider Tests', () {
    test('initial state should be unauthenticated', () {
      final authProvider = AuthProvider(auth: mockAuth);
      expect(authProvider.isAuthenticated, false);
      expect(authProvider.isInitializing, true);
    });

    test('login method should exist', () {
      final authProvider = AuthProvider(auth: mockAuth);
      expect(authProvider.login, isNotNull);
    });
  });
}
