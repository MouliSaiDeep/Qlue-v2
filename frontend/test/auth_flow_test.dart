import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:dio/dio.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/screens/auth/login_screen.dart';
import 'package:frontend/core/theme.dart';

class MockFirebaseAuth extends Mock implements FirebaseAuth {}
class MockUser extends Mock implements User {}
class MockGoogleSignIn extends Mock implements GoogleSignIn {}
class MockDio extends Mock implements Dio {}
class MockUserCredential extends Mock implements UserCredential {}
class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockFirebaseAuth mockAuth;
  late MockUser mockUser;
  late MockGoogleSignIn mockGoogleSignIn;
  late MockDio mockDio;
  late AuthProvider authProvider;

  setUp(() {
    mockAuth = MockFirebaseAuth();
    mockUser = MockUser();
    mockGoogleSignIn = MockGoogleSignIn();
    mockDio = MockDio();

    when(() => mockAuth.authStateChanges()).thenAnswer((_) => Stream.value(null));
    when(() => mockUser.email).thenReturn('test@test.com');
    when(() => mockUser.uid).thenReturn('user123');
    when(() => mockUser.emailVerified).thenReturn(true);

    authProvider = MockAuthProvider();
    
    // Default mocks for the provider
    when(() => authProvider.isLoading).thenReturn(false);
    when(() => authProvider.error).thenReturn(null);
    when(() => authProvider.isAuthenticated).thenReturn(false);
    when(() => authProvider.isInitializing).thenReturn(false);
    when(() => authProvider.currentUser).thenReturn(null);
  });

  Widget createTestWidget(Widget child) {
    return AppThemeColorsProvider(
      colors: AppThemeColors.dark,
      child: ChangeNotifierProvider<AuthProvider>.value(
        value: authProvider,
        child: MaterialApp(
          home: child,
        ),
      ),
    );
  }

  group('Auth Flow Tests', () {
    testWidgets('Login Flow - Success', (WidgetTester tester) async {
      when(() => authProvider.login(any(), any())).thenAnswer((_) async => {});
      when(() => authProvider.currentUser).thenReturn(mockUser);

      await tester.pumpWidget(createTestWidget(const ExactLoginScreen()));

      // Enter credentials
      await tester.enterText(find.byType(TextField).first, 'test@test.com');
      await tester.enterText(find.byType(TextField).last, 'password123');
      
      // Tap Sign In button
      await tester.tap(find.text('Sign In'));
      
      await tester.pump();

      // Check if the login method was called correctly on the provider.
      verify(() => authProvider.login('test@test.com', 'password123')).called(1);
    });
  });
}
