import 'dart:async';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/screens/auth/delete_account_dialog.dart';

class MockAuth extends Mock implements FirebaseAuth {}

class MockUser extends Mock implements User {}

class MockInfo extends Mock implements UserInfo {}

class MockCredential extends Mock implements UserCredential {}

class MockGoogle extends Mock implements GoogleSignIn {}

class MockGoogleAccount extends Mock implements GoogleSignInAccount {}

class MockDio extends Mock implements Dio {}

void main() {
  late MockAuth firebase;
  late MockUser user;
  late MockInfo info;
  late MockGoogle google;
  late MockDio api;
  late AuthProvider auth;
  late StreamController<User?> changes;
  setUpAll(() {
    registerFallbackValue(
      EmailAuthProvider.credential(email: 'test@example.com', password: 'test'),
    );
  });
  setUp(() {
    firebase = MockAuth();
    user = MockUser();
    info = MockInfo();
    google = MockGoogle();
    api = MockDio();
    changes = StreamController<User?>.broadcast();
    when(() => firebase.currentUser).thenReturn(user);
    when(() => firebase.authStateChanges()).thenAnswer((_) => changes.stream);
    when(() => user.uid).thenReturn('owner');
    when(() => user.email).thenReturn('owner@example.com');
    when(() => user.providerData).thenReturn([info]);
    when(() => info.providerId).thenReturn('password');
    when(
      () => user.reauthenticateWithCredential(any()),
    ).thenAnswer((_) async => MockCredential());
    when(() => user.getIdToken(true)).thenAnswer((_) async => 'fresh-proof');
    when(() => firebase.signOut()).thenAnswer((_) async {});
    when(() => google.signOut()).thenAnswer((_) async {});
    when(
      () => api.delete<dynamic>(
        any(),
        data: any(named: 'data'),
        options: any(named: 'options'),
      ),
    ).thenAnswer(
      (_) async => Response(
        requestOptions: RequestOptions(path: '/auth/account'),
        statusCode: 202,
        data: {
          'deletionAccepted': true,
          'identityDeleted': true,
          'status': 'PENDING',
        },
      ),
    );
    auth = AuthProvider(auth: firebase, googleSignIn: google, api: api);
  });
  tearDown(() async {
    auth.dispose();
    await changes.close();
  });

  test(
    'reauthenticates before submitting explicit confirmation and clears local login only after acceptance',
    () async {
      expect(
        await auth.deleteAccount(
          expectedUid: 'owner',
          password: 'current-password',
        ),
        isNull,
      );
      final credential =
          verify(
                () => user.reauthenticateWithCredential(captureAny()),
              ).captured.single
              as EmailAuthCredential;
      expect(credential.email, 'owner@example.com');
      expect(credential.password, 'current-password');
      final call = verify(
        () => api.delete<dynamic>(
          '/auth/account',
          data: captureAny(named: 'data'),
          options: captureAny(named: 'options'),
        ),
      ).captured;
      expect(call.first, {'confirmation': 'DELETE'});
      expect(
        (call.last as Options).headers!['Authorization'],
        'Bearer fresh-proof',
      );
      verify(() => firebase.signOut()).called(1);
      verifyNever(() => user.delete());
      expect(auth.currentUser, isNull);
      expect(
        auth.accountDeletionNotice,
        contains('Firebase account has been removed'),
      );
    },
  );
  test('wrong password never starts remote deletion or signs out', () async {
    when(
      () => user.reauthenticateWithCredential(any()),
    ).thenThrow(FirebaseAuthException(code: 'wrong-password'));
    expect(
      await auth.deleteAccount(expectedUid: 'owner', password: 'wrong'),
      contains('incorrect'),
    );
    verifyNever(
      () => api.delete<dynamic>(
        any(),
        data: any(named: 'data'),
        options: any(named: 'options'),
      ),
    );
    verifyNever(() => firebase.signOut());
  });
  test('empty password and changed account are rejected locally', () async {
    expect(
      await auth.deleteAccount(expectedUid: 'owner'),
      contains('current password'),
    );
    expect(
      await auth.deleteAccount(expectedUid: 'other', password: 'password'),
      contains('account changed'),
    );
    verifyNever(() => user.reauthenticateWithCredential(any()));
  });
  test(
    'account switch during reauthentication cannot delete the new account',
    () async {
      final pending = Completer<UserCredential>();
      when(
        () => user.reauthenticateWithCredential(any()),
      ).thenAnswer((_) => pending.future);
      final result = auth.deleteAccount(
        expectedUid: 'owner',
        password: 'password',
      );
      final other = MockUser();
      when(() => other.uid).thenReturn('other');
      when(() => firebase.currentUser).thenReturn(other);
      pending.complete(MockCredential());
      expect(await result, contains('account changed'));
      verifyNever(
        () => api.delete<dynamic>(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      );
      verifyNever(() => firebase.signOut());
    },
  );
  test(
    'account switch during API call cannot sign out the new account',
    () async {
      final pending = Completer<Response<dynamic>>();
      when(
        () => api.delete<dynamic>(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer((_) => pending.future);
      final result = auth.deleteAccount(
        expectedUid: 'owner',
        password: 'password',
      );
      await Future<void>.delayed(Duration.zero);
      final other = MockUser();
      when(() => other.uid).thenReturn('other');
      when(() => firebase.currentUser).thenReturn(other);
      pending.complete(
        Response(
          requestOptions: RequestOptions(path: '/auth/account'),
          statusCode: 202,
          data: {'deletionAccepted': true},
        ),
      );
      expect(await result, contains('current account was not changed'));
      verifyNever(() => firebase.signOut());
    },
  );
  test('concurrent submissions cannot start duplicate requests', () async {
    final pending = Completer<UserCredential>();
    when(
      () => user.reauthenticateWithCredential(any()),
    ).thenAnswer((_) => pending.future);
    final result = auth.deleteAccount(
      expectedUid: 'owner',
      password: 'password',
    );
    expect(
      await auth.deleteAccount(expectedUid: 'owner', password: 'password'),
      contains('already in progress'),
    );
    pending.complete(MockCredential());
    expect(await result, isNull);
    verify(() => user.reauthenticateWithCredential(any())).called(1);
  });
  test(
    'legacy success response cannot be mistaken for durable deletion acceptance',
    () async {
      when(
        () => api.delete<dynamic>(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/auth/account'),
          statusCode: 200,
          data: {'message': 'success'},
        ),
      );
      expect(
        await auth.deleteAccount(expectedUid: 'owner', password: 'password'),
        contains('could not be confirmed'),
      );
      verifyNever(() => firebase.signOut());
      expect(auth.accountDeletionNotice, isNull);
    },
  );
  test(
    'identity retry is reported honestly and local sign-out errors do not undo remote acceptance',
    () async {
      when(
        () => api.delete<dynamic>(
          any(),
          data: any(named: 'data'),
          options: any(named: 'options'),
        ),
      ).thenAnswer(
        (_) async => Response(
          requestOptions: RequestOptions(path: '/auth/account'),
          statusCode: 202,
          data: {'deletionAccepted': true, 'identityDeleted': false},
        ),
      );
      when(
        () => firebase.signOut(),
      ).thenThrow(Exception('local provider unavailable'));
      expect(
        await auth.deleteAccount(expectedUid: 'owner', password: 'password'),
        isNull,
      );
      expect(auth.accountDeletionNotice, contains('retrying automatically'));
    },
  );
  test('Google account mismatch cannot delete an account', () async {
    when(() => info.providerId).thenReturn('google.com');
    final account = MockGoogleAccount();
    when(() => google.authenticate()).thenAnswer((_) async => account);
    when(
      () => account.authentication,
    ).thenReturn(const GoogleSignInAuthentication(idToken: 'google-proof'));
    when(
      () => user.reauthenticateWithCredential(any()),
    ).thenThrow(FirebaseAuthException(code: 'user-mismatch'));
    expect(
      await auth.deleteAccount(expectedUid: 'owner'),
      contains('Choose the Google account'),
    );
    verifyNever(
      () => api.delete<dynamic>(
        any(),
        data: any(named: 'data'),
        options: any(named: 'options'),
      ),
    );
  });
  Widget host({bool usesPassword = true}) => AppThemeColorsProvider(
    colors: AppThemeColors.dark,
    child: ChangeNotifierProvider<AuthProvider>.value(
      value: auth,
      child: MaterialApp(
        home: Scaffold(
          body: DeleteAccountDialog(
            expectedUid: 'owner',
            email: 'owner@example.com',
            usesPassword: usesPassword,
          ),
        ),
      ),
    ),
  );
  testWidgets(
    'dialog requires typed confirmation and password; password is obscured',
    (tester) async {
      await tester.pumpWidget(host());
      await tester.tap(find.byKey(const Key('delete-account-submit')));
      await tester.pump();
      expect(find.text('Type DELETE to confirm.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('delete-account-confirmation')),
        'DELETE',
      );
      await tester.tap(find.byKey(const Key('delete-account-submit')));
      await tester.pump();
      expect(
        find.text('Enter your current password to confirm deletion.'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('delete-account-password')))
            .obscureText,
        true,
      );
      verifyNever(() => user.reauthenticateWithCredential(any()));
    },
  );
  testWidgets('busy dialog prevents duplicate submission and cancellation', (
    tester,
  ) async {
    final pending = Completer<UserCredential>();
    when(
      () => user.reauthenticateWithCredential(any()),
    ).thenAnswer((_) => pending.future);
    await tester.pumpWidget(host());
    await tester.enterText(
      find.byKey(const Key('delete-account-confirmation')),
      'DELETE',
    );
    await tester.enterText(
      find.byKey(const Key('delete-account-password')),
      'wrong',
    );
    await tester.tap(find.byKey(const Key('delete-account-submit')));
    await tester.pump();
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('delete-account-submit')))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Cancel'))
          .onPressed,
      isNull,
    );
    pending.completeError(FirebaseAuthException(code: 'wrong-password'));
    await tester.pump();
    expect(find.text('The current password is incorrect.'), findsOneWidget);
  });
  testWidgets(
    'Google deletion dialog omits password and explains provider confirmation',
    (tester) async {
      await tester.pumpWidget(host(usesPassword: false));
      expect(find.byKey(const Key('delete-account-password')), findsNothing);
      expect(find.text('Confirm with Google'), findsOneWidget);
      expect(find.textContaining('same Google account'), findsOneWidget);
    },
  );
}
