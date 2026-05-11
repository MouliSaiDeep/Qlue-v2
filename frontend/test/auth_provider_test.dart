import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:dio/dio.dart';
import 'package:frontend/context/auth_provider.dart' as local;

class MockFirebaseAuth extends Mock implements FirebaseAuth {}
class MockUser extends Mock implements User {}
class MockGoogleSignIn extends Mock implements GoogleSignIn {}
class MockDio extends Mock implements Dio {}
class MockResponse extends Mock implements Response {}

void main() {
  late MockFirebaseAuth mockAuth;
  late MockUser mockUser;
  late MockGoogleSignIn mockGoogleSignIn;
  late MockDio mockDio;

  setUpAll(() {
    registerFallbackValue(Uri());
  });

  setUp(() {
    mockAuth = MockFirebaseAuth();
    mockUser = MockUser();
    mockGoogleSignIn = MockGoogleSignIn();
    mockDio = MockDio();

    when(() => mockAuth.authStateChanges()).thenAnswer((_) => Stream.value(null));
  });

  group('AuthProvider Tests', () {
    test('initial state should be unauthenticated and initializing', () async {
      final authProvider = local.AuthProvider(
        auth: mockAuth,
        googleSignIn: mockGoogleSignIn,
        dio: mockDio,
      );
      
      expect(authProvider.isAuthenticated, false);
      expect(authProvider.isInitializing, true);
      
      // Wait for initialization delay in AuthProvider constructor
      await Future.delayed(const Duration(milliseconds: 2100));
      expect(authProvider.isInitializing, false);
    });

    test('login should succeed if backend and firebase succeed', () async {
      final authProvider = local.AuthProvider(
        auth: mockAuth,
        googleSignIn: mockGoogleSignIn,
        dio: mockDio,
      );

      final mockResponse = MockResponse();
      when(() => mockResponse.statusCode).thenReturn(200);
      when(() => mockDio.post(any(), data: any(named: 'data')))
          .thenAnswer((_) async => mockResponse);

      when(() => mockAuth.signInWithEmailAndPassword(
        email: 'test@example.com',
        password: 'password',
      )).thenAnswer((_) async => MockUserCredential());

      await authProvider.login('test@example.com', 'password');

      expect(authProvider.error, null);
      verify(() => mockAuth.signInWithEmailAndPassword(
        email: 'test@example.com',
        password: 'password',
      )).called(1);
    });

    test('login should set error if backend fails with 403', () async {
      final authProvider = local.AuthProvider(
        auth: mockAuth,
        googleSignIn: mockGoogleSignIn,
        dio: mockDio,
      );

      when(() => mockDio.post(any(), data: any(named: 'data')))
          .thenThrow(DioException(
            requestOptions: RequestOptions(path: ''),
            response: Response(
              requestOptions: RequestOptions(path: ''),
              statusCode: 403,
            ),
          ));

      await authProvider.login('test@example.com', 'password');

      expect(authProvider.error, 'EMAIL_NOT_VERIFIED');
    });

    test('logout should call firebase and google sign out', () async {
      final authProvider = local.AuthProvider(
        auth: mockAuth,
        googleSignIn: mockGoogleSignIn,
        dio: mockDio,
      );

      when(() => mockAuth.signOut()).thenAnswer((_) async => {});
      when(() => mockGoogleSignIn.signOut()).thenAnswer((_) async => null);

      await authProvider.logout();

      verify(() => mockAuth.signOut()).called(1);
      verify(() => mockGoogleSignIn.signOut()).called(1);
      expect(authProvider.isAuthenticated, false);
    });
  });
}

class MockUserCredential extends Mock implements UserCredential {}
