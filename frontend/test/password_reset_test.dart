import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/screens/auth/password_reset_dialog.dart';
import 'package:frontend/screens/auth/login_screen.dart';
import 'package:frontend/screens/tabs/profile_screen.dart';
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/context/resume_provider.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:package_info_plus/package_info_plus.dart';

class MockAuth extends Mock implements FirebaseAuth {}

class MockUser extends Mock implements User {}

class MockInfo extends Mock implements UserInfo {}

class MockProfileAuth extends Mock implements AuthProvider {}

class MockDashboard extends Mock implements DashboardProvider {}

class MockResumes extends Mock implements ResumeProvider {}

void main() {
  late MockAuth firebase;
  late MockUser user;
  late MockInfo info;
  late AuthProvider auth;
  late DateTime now;

  setUp(() {
    firebase = MockAuth();
    user = MockUser();
    info = MockInfo();
    now = DateTime.utc(2026, 10, 18);
    when(() => firebase.currentUser).thenReturn(null);
    when(
      () => firebase.authStateChanges(),
    ).thenAnswer((_) => const Stream<User?>.empty());
    when(
      () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
    ).thenAnswer((_) async {});
    when(() => user.uid).thenReturn('account-a');
    when(() => user.email).thenReturn('owner@example.com');
    when(() => user.providerData).thenReturn([info]);
    when(() => info.providerId).thenReturn('password');
    auth = AuthProvider(auth: firebase, now: () => now);
  });
  tearDown(() => auth.dispose());

  test(
    'normalizes email, sends through Firebase and leaves authentication alone',
    () async {
      expect(await auth.requestPasswordReset('  User@Example.com  '), isNull);
      verify(
        () => firebase.sendPasswordResetEmail(email: 'user@example.com'),
      ).called(1);
      expect(auth.currentUser, isNull);
      expect(auth.isAuthenticated, false);
      expect(auth.isLoading, false);
      expect(auth.error, isNull);
    },
  );

  for (final email in [
    '',
    'no-at-sign',
    'a@b',
    'a\nb@example.com',
    '${'x' * 250}@example.com',
  ]) {
    test(
      'invalid email rejected without making a request: ${email.length}',
      () async {
        expect(
          await auth.requestPasswordReset(email),
          'Enter a valid email address.',
        );
        verifyNever(
          () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
        );
        expect(auth.passwordResetRetryAfterSeconds, 0);
      },
    );
  }

  for (final code in [
    'user-not-found',
    'user-disabled',
    'invalid-credential',
    'invalid-login-credentials',
  ]) {
    test(
      '$code returns the same neutral result as an eligible account',
      () async {
        when(
          () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
        ).thenThrow(
          FirebaseAuthException(code: code, message: 'private provider detail'),
        );
        expect(await auth.requestPasswordReset('unknown@example.com'), isNull);
        expect(auth.passwordResetRetryAfterSeconds, 60);
      },
    );
  }

  test(
    'concurrent and repeated requests cannot bypass cooldown by changing email',
    () async {
      final pending = Completer<void>();
      when(
        () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
      ).thenAnswer((_) => pending.future);
      final first = auth.requestPasswordReset('owner@example.com');
      expect(
        await auth.requestPasswordReset('other@example.com'),
        contains('Please wait'),
      );
      pending.complete();
      expect(await first, isNull);
      expect(
        await auth.requestPasswordReset('owner@example.com'),
        contains('Please wait'),
      );
      verify(
        () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
      ).called(1);
      now = now.add(const Duration(seconds: 61));
      expect(auth.passwordResetRetryAfterSeconds, 0);
      expect(await auth.requestPasswordReset('owner@example.com'), isNull);
    },
  );

  for (final code in [
    'too-many-requests',
    'quota-exceeded',
    'network-request-failed',
    'operation-not-allowed',
    'internal-error',
  ]) {
    test(
      '$code reports a safe error without leaking provider details or claiming success',
      () async {
        when(
          () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
        ).thenThrow(
          FirebaseAuthException(code: code, message: 'private provider detail'),
        );
        final error = await auth.requestPasswordReset('owner@example.com');
        expect(error, isNotNull);
        expect(error, isNot(contains('private provider detail')));
        expect(auth.passwordResetRetryAfterSeconds, 60);
      },
    );
  }

  test(
    'profile recovery uses the Firebase email of the expected current UID',
    () async {
      when(() => firebase.currentUser).thenReturn(user);
      expect(await auth.requestCurrentUserPasswordReset('account-a'), isNull);
      verify(
        () => firebase.sendPasswordResetEmail(email: 'owner@example.com'),
      ).called(1);
    },
  );

  test('profile recovery refuses an account switch or sign-out', () async {
    expect(
      await auth.requestCurrentUserPasswordReset('account-a'),
      contains('account changed'),
    );
    when(() => firebase.currentUser).thenReturn(user);
    expect(
      await auth.requestCurrentUserPasswordReset('account-b'),
      contains('account changed'),
    );
    verifyNever(
      () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
    );
  });

  test(
    'Google-only profile never creates a new password sign-in path',
    () async {
      when(() => firebase.currentUser).thenReturn(user);
      when(() => info.providerId).thenReturn('google.com');
      expect(
        await auth.requestCurrentUserPasswordReset('account-a'),
        contains('Google Account'),
      );
      verifyNever(
        () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
      );
    },
  );

  test('password strength is checked before reauthentication', () async {
    when(() => firebase.currentUser).thenReturn(user);
    for (final password in [
      'short1!',
      'password123',
      'PASSWORD123!',
      'Password!!!',
      'Password123',
    ]) {
      expect(
        await auth.changePassword('current', password),
        AuthProvider.passwordRequirements,
      );
    }
    expect(AuthProvider.isStrongPassword('Password123!'), true);
    expect(AuthProvider.isStrongPassword('Password123 '), false);
  });

  Widget host(Widget child) => AppThemeColorsProvider(
    colors: AppThemeColors.dark,
    child: ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(home: Scaffold(body: child)),
    ),
  );

  testWidgets('profile Reset Password row opens the locked recovery dialog', (
    tester,
  ) async {
    final profile = MockProfileAuth(),
        dashboard = MockDashboard(),
        resumes = MockResumes();
    when(() => profile.currentUser).thenReturn(user);
    when(() => profile.profileImageUrl).thenReturn('');
    when(() => profile.displayName).thenReturn('Owner');
    when(() => profile.profession).thenReturn('');
    when(() => profile.skills).thenReturn([]);
    when(() => profile.voiceId).thenReturn('Ruth');
    when(() => profile.isPremiumVoice).thenReturn(false);
    when(() => profile.email).thenReturn('owner@example.com');
    when(() => profile.passwordResetRetryAfterSeconds).thenReturn(0);
    when(
      () => profile.requestCurrentUserPasswordReset('account-a'),
    ).thenAnswer((_) async => null);
    when(() => dashboard.summary).thenReturn(DashboardSummary.initial());
    when(() => dashboard.fetchDashboardData()).thenAnswer((_) async {});
    when(() => resumes.resumes).thenReturn([]);
    when(() => resumes.fetchResumes()).thenAnswer((_) async {});
    PackageInfo.setMockInitialValues(
      appName: 'Qlue',
      packageName: 'com.qlue.sloths1',
      version: '1.0.9',
      buildNumber: '10009',
      buildSignature: '',
    );
    await tester.pumpWidget(
      AppThemeColorsProvider(
        colors: AppThemeColors.dark,
        child: MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: profile),
            ChangeNotifierProvider<DashboardProvider>.value(value: dashboard),
            ChangeNotifierProvider<ResumeProvider>.value(value: resumes),
          ],
          child: const MaterialApp(home: ProfileScreen()),
        ),
      ),
    );
    await tester.pump();
    await tester.scrollUntilVisible(
      find.byKey(const Key('profile-reset-password')),
      350,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('profile-reset-password')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    final field = tester.widget<TextField>(
      find.byKey(const Key('password-reset-email')),
    );
    expect(field.readOnly, true);
    expect(field.controller!.text, 'owner@example.com');
    await tester.tap(find.byKey(const Key('password-reset-send')));
    await tester.pump();
    verify(
      () => profile.requestCurrentUserPasswordReset('account-a'),
    ).called(1);
    expect(
      find.byKey(const Key('password-reset-confirmation')),
      findsOneWidget,
    );
    await tester.tap(find.text('Done'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.scrollUntilVisible(
      find.byKey(const Key('profile-delete-account')),
      350,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const Key('profile-delete-account')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Delete account permanently?'), findsOneWidget);
    expect(find.text('owner@example.com'), findsWidgets);
    expect(find.byKey(const Key('delete-account-password')), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('login button opens recovery and prefills typed email', (
    tester,
  ) async {
    await tester.pumpWidget(host(const ExactLoginScreen()));
    await tester.enterText(
      find.byType(EditableText).first,
      'typed@example.com',
    );
    await tester.ensureVisible(find.text('Forgot Password?'));
    await tester.tap(find.text('Forgot Password?'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    final field = tester.widget<TextField>(
      find.byKey(const Key('password-reset-email')),
    );
    expect(field.controller!.text, 'typed@example.com');
    expect(field.readOnly, false);
    await tester.tap(find.text('Cancel'));
    await tester.pump(const Duration(milliseconds: 300));
  });

  testWidgets(
    'dialog validates input and displays neutral confirmation after sending',
    (tester) async {
      await tester.pumpWidget(host(const PasswordResetDialog()));
      await tester.tap(find.byKey(const Key('password-reset-send')));
      await tester.pump();
      expect(find.text('Enter a valid email address.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('password-reset-email')),
        'owner@example.com',
      );
      await tester.tap(find.byKey(const Key('password-reset-send')));
      await tester.pump();
      expect(
        find.byKey(const Key('password-reset-confirmation')),
        findsOneWidget,
      );
      final send = tester.widget<TextButton>(
        find.byKey(const Key('password-reset-send')),
      );
      expect(send.onPressed, isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'profile dialog keeps email read-only and rejects stale identity',
    (tester) async {
      await tester.pumpWidget(
        host(
          const PasswordResetDialog(
            initialEmail: 'owner@example.com',
            currentAccountOnly: true,
            expectedUid: 'account-a',
          ),
        ),
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('password-reset-email')))
            .readOnly,
        true,
      );
      await tester.tap(find.byKey(const Key('password-reset-send')));
      await tester.pump();
      expect(find.textContaining('account changed'), findsOneWidget);
      expect(
        find.byKey(const Key('password-reset-confirmation')),
        findsNothing,
      );
      verifyNever(
        () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
      );
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('provider failure shows error instead of success', (
    tester,
  ) async {
    when(
      () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
    ).thenThrow(FirebaseAuthException(code: 'network-request-failed'));
    await tester.pumpWidget(
      host(const PasswordResetDialog(initialEmail: 'owner@example.com')),
    );
    await tester.tap(find.byKey(const Key('password-reset-send')));
    await tester.pump();
    expect(find.textContaining('Could not connect'), findsOneWidget);
    expect(find.byKey(const Key('password-reset-confirmation')), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('an unresponsive provider times out without reporting success', (
    tester,
  ) async {
    final pending = Completer<void>();
    when(
      () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
    ).thenAnswer((_) => pending.future);
    final result = auth.requestPasswordReset('owner@example.com');
    await tester.pump(const Duration(seconds: 21));
    expect(await result, contains('Could not confirm the request'));
    pending.complete();
    await tester.pump();
  });

  testWidgets('closing dialog during an outstanding request is safe', (
    tester,
  ) async {
    final pending = Completer<void>();
    when(
      () => firebase.sendPasswordResetEmail(email: any(named: 'email')),
    ).thenAnswer((_) => pending.future);
    await tester.pumpWidget(
      host(const PasswordResetDialog(initialEmail: 'owner@example.com')),
    );
    await tester.tap(find.byKey(const Key('password-reset-send')));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    pending.complete();
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
