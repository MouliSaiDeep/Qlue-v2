import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/screens/auth/verify_email_screen.dart';
import 'package:frontend/screens/auth/register_screen.dart';
import 'package:frontend/app.dart';

class FakeAuth extends Mock implements FirebaseAuth {
  User? selected;
  final events = StreamController<User?>.broadcast(sync: true);
  @override
  User? get currentUser => selected;
  @override
  Stream<User?> authStateChanges() => events.stream;
  void select(User user) {
    selected = user;
    events.add(user);
  }
}

class MockUser extends Mock implements User {}

class MockCredential extends Mock implements UserCredential {}

class MockProvider extends Mock implements AuthProvider {}

class Adapter implements HttpClientAdapter {
  final calls = <RequestOptions>[];
  String? rejectedPath;
  bool alreadyVerified = false;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    final rejected = options.path == rejectedPath;
    final Object body = rejected
        ? {'error': 'Controlled failure'}
        : options.path.endsWith('send-otp')
        ? alreadyVerified
              ? {'verified': true}
              : {'challengeId': 'a' * 32, 'resendAfterSeconds': 60}
        : {'verified': true};
    return ResponseBody.fromString(
      jsonEncode(body),
      rejected ? 503 : 200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late FakeAuth firebase;
  late MockUser user;
  late MockCredential credential;
  late Adapter transport;
  late AuthProvider provider;
  late bool verified;
  setUp(() {
    firebase = FakeAuth();
    user = MockUser();
    credential = MockCredential();
    verified = false;
    when(() => user.uid).thenReturn('u');
    when(() => user.email).thenReturn('user@example.com');
    when(() => user.emailVerified).thenAnswer((_) => verified);
    when(() => user.reload()).thenAnswer((_) async {
      verified = true;
    });
    when(
      () => user.getIdToken(true),
    ).thenAnswer((_) async => 'fresh-verified-token');
    when(() => credential.user).thenReturn(user);
    when(
      () => firebase.signInWithEmailAndPassword(
        email: any(named: 'email'),
        password: any(named: 'password'),
      ),
    ).thenAnswer((_) async {
      firebase.select(user);
      return credential;
    });
    transport = Adapter();
    final dio = Dio(BaseOptions(baseUrl: 'https://example.invalid'))
      ..httpClientAdapter = transport;
    provider = AuthProvider(auth: firebase, api: dio);
  });
  tearDown(() async {
    provider.dispose();
    await firebase.events.close();
  });
  Future<void> register() =>
      provider.register('user@example.com', 'Password123!', 'Person');

  test(
    'unverified sign-in never grants access or starts profile requests',
    () async {
      firebase.select(user);
      expect(provider.isAuthenticated, false);
      expect(provider.requiresEmailVerification, true);
      expect(transport.calls, isEmpty);
    },
  );
  test(
    'registration signs in only to verification, then refreshes claims after OTP',
    () async {
      await register();
      expect(provider.requiresEmailVerification, true);
      expect(provider.isAuthenticated, false);
      expect(await provider.requestEmailOtp(), true);
      expect(await provider.verifyEmailOtp('123456'), true);
      expect(provider.isAuthenticated, true);
      expect(provider.otpChallengeId, isNull);
      verify(() => user.getIdToken(true)).called(1);
      expect(
        transport.calls.where((c) => c.path.endsWith('verify-otp')).single.data,
        {'challengeId': 'a' * 32, 'code': '123456'},
      );
    },
  );
  test(
    'failed account creation never signs in or reports verification success',
    () async {
      transport.rejectedPath = '/auth/register';
      await register();
      expect(provider.error, 'Controlled failure');
      expect(provider.currentUser, isNull);
      verifyNever(
        () => firebase.signInWithEmailAndPassword(
          email: any(named: 'email'),
          password: any(named: 'password'),
        ),
      );
    },
  );
  test('bad OTP never reloads or unlocks the account', () async {
    await register();
    await provider.requestEmailOtp();
    transport.rejectedPath = '/auth/verify-otp';
    expect(await provider.verifyEmailOtp('123456'), false);
    expect(provider.isAuthenticated, false);
    verifyNever(() => user.reload());
  });
  test('failed token refresh keeps the verification gate closed', () async {
    await register();
    await provider.requestEmailOtp();
    when(() => user.getIdToken(true)).thenThrow(Exception('offline'));
    expect(await provider.verifyEmailOtp('123456'), false);
    expect(provider.isAuthenticated, false);
    expect(provider.requiresEmailVerification, true);
  });
  test(
    'already verified backend state can recover a lost successful response',
    () async {
      await register();
      transport.alreadyVerified = true;
      expect(await provider.requestEmailOtp(), true);
      expect(provider.isAuthenticated, true);
    },
  );

  Widget wrap(AuthProvider auth, Widget child) => AppThemeColorsProvider(
    colors: AppThemeColors.dark,
    child: ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(home: child),
    ),
  );
  testWidgets('code input accepts six digits and resend waits for cooldown', (
    tester,
  ) async {
    final auth = MockProvider();
    when(() => auth.isLoading).thenReturn(false);
    when(() => auth.error).thenReturn(null);
    when(() => auth.currentUser).thenReturn(user);
    when(() => auth.otpChallengeId).thenReturn('a' * 32);
    when(
      () => auth.otpResendAt,
    ).thenReturn(DateTime.now().add(const Duration(seconds: 60)));
    when(() => auth.verifyEmailOtp(any())).thenAnswer((_) async => false);
    await tester.pumpWidget(wrap(auth, const VerifyEmailScreen()));
    await tester.pump();
    await tester.enterText(find.byKey(const Key('email-otp-input')), '1234567');
    await tester.tap(find.text('Verify and continue'));
    await tester.pump();
    verify(() => auth.verifyEmailOtp('123456')).called(1);
    final resend = tester.widget<TextButton>(
      find.byKey(const Key('email-otp-resend')),
    );
    expect(resend.onPressed, isNull);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('an unverified session cannot navigate into protected pages', (
    tester,
  ) async {
    final auth = MockProvider();
    when(() => auth.isInitializing).thenReturn(false);
    when(() => auth.isAuthenticated).thenReturn(false);
    when(() => auth.requiresEmailVerification).thenReturn(true);
    when(() => auth.isLoading).thenReturn(false);
    when(() => auth.error).thenReturn(null);
    when(() => auth.currentUser).thenReturn(user);
    when(() => auth.otpChallengeId).thenReturn('a' * 32);
    when(() => auth.otpResendAt).thenReturn(null);
    final router = buildAppRouter(auth);
    await tester.pumpWidget(
      AppThemeColorsProvider(
        colors: AppThemeColors.dark,
        child: ChangeNotifierProvider<AuthProvider>.value(
          value: auth,
          child: MaterialApp.router(routerConfig: router),
        ),
      ),
    );
    router.go('/dashboard');
    await tester.pump();
    await tester.pump();
    expect(router.routeInformationProvider.value.uri.path, '/verify-email');
    expect(find.text('Verify your email'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    router.dispose();
  });
  testWidgets(
    'registration failure remains on the form instead of showing success',
    (tester) async {
      final auth = MockProvider();
      when(() => auth.register(any(), any(), any())).thenAnswer((_) async {});
      when(
        () => auth.error,
      ).thenReturn('Email verification is not configured yet.');
      await tester.pumpWidget(wrap(auth, const ExactRegisterScreen()));
      final inputs = find.byType(EditableText);
      await tester.enterText(inputs.at(0), 'Person');
      await tester.enterText(inputs.at(1), 'user@example.com');
      await tester.enterText(inputs.at(2), 'Password123!');
      await tester.tap(
        find.text('I agree to the Terms of Service and Privacy Policy'),
      );
      await tester.ensureVisible(find.text('Create Account').last);
      await tester.tap(find.text('Create Account').last);
      await tester.pump();
      expect(
        find.text('Email verification is not configured yet.'),
        findsOneWidget,
      );
      expect(find.text('Check your email!'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
