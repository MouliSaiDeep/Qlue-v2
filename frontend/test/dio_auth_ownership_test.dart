import 'dart:async';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:frontend/core/network/dio_client.dart';

class FakeAuth extends Mock implements FirebaseAuth {
  User? selected;
  final events = StreamController<User?>.broadcast(sync: true);
  @override
  User? get currentUser => selected;
  @override
  Stream<User?> authStateChanges() => events.stream;
  void select(User? user) {
    selected = user;
    events.add(user);
  }
}

class FakeUser extends Mock implements User {}

class Transport implements HttpClientAdapter {
  Transport(this.reply);
  final Future<ResponseBody> Function(RequestOptions) reply;
  final sent = <Map<String, dynamic>>[];
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? stream,
    Future<void>? cancelFuture,
  ) async {
    sent.add({
      'headers': Map.of(options.headers),
      'body': options.data,
      'cancel': options.cancelToken,
      'path': options.path,
    });
    return reply(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody status(int code) => ResponseBody.fromString('{}', code);
Future<void> flush(WidgetTester tester) async {
  for (var i = 0; i < 25; i++) {
    await tester.pump(const Duration(milliseconds: 1));
  }
}

class Result {
  Object? error;
  Response? response;
  bool settled = false;
  Future<void> observe(Future<Response> request) => request.then<void>(
    (r) {
      response = r;
      settled = true;
    },
    onError: (Object e) {
      error = e;
      settled = true;
    },
  );
}

void main() {
  late FakeAuth auth;
  late FakeUser a, b;
  late DioClient client;
  late Transport transport;
  late int refreshes;
  setUp(() {
    auth = FakeAuth();
    a = FakeUser();
    b = FakeUser();
    refreshes = 0;
    when(() => a.uid).thenReturn('A');
    when(() => b.uid).thenReturn('B');
    when(() => a.getIdToken(false)).thenAnswer((_) async => 'A-initial');
    when(() => a.getIdToken(true)).thenAnswer((_) async {
      refreshes++;
      return 'A-refreshed';
    });
    when(() => b.getIdToken(false)).thenAnswer((_) async => 'B-initial');
    when(() => b.getIdToken(true)).thenAnswer((_) async => 'B-refreshed');
    auth.select(a);
    client = DioClient.withAuth(auth);
    client.dio.transformer = SyncTransformer();
    transport = Transport((_) async => status(200));
    client.dio.httpClientAdapter = transport;
  });
  tearDown(() async {
    await client.close();
    await auth.events.close();
  });

  testWidgets(
    'A mutation awaiting 401 is cancelled on A to B; never refreshed as B',
    (t) async {
      final reply = Completer<ResponseBody>();
      transport = Transport((_) => reply.future);
      client.dio.httpClientAdapter = transport;
      final result = Result();
      final done = result.observe(
        client.dio.post('/profile', data: {'draft': 'A'}),
      );
      await flush(t);
      expect(
        transport.sent.single['headers']['Authorization'],
        'Bearer A-initial',
      );
      auth.select(b);
      await flush(t);
      expect(result.settled, true);
      reply.complete(status(401));
      await flush(t);
      await done;
      expect(
        (result.error as DioException).type,
        DioExceptionType.cancel,
        reason: '${result.error}',
      );
      expect(transport.sent, hasLength(1));
      expect(refreshes, 0);
      verifyNever(() => b.getIdToken(true));
    },
  );

  testWidgets('ownership is captured before queued interceptors', (t) async {
    final result = Result();
    final done = result.observe(
      client.dio.post('/mutation', data: {'draft': 'A'}),
    );
    auth.select(b);
    await flush(t);
    await done;
    expect((result.error as DioException).type, DioExceptionType.cancel);
    expect(transport.sent, isEmpty);
    verifyNever(() => b.getIdToken(false));
  });

  testWidgets('A logout A cancels old login; new A request works', (t) async {
    final old = Completer<ResponseBody>();
    transport = Transport((_) => old.future);
    client.dio.httpClientAdapter = transport;
    final result = Result();
    final done = result.observe(
      client.dio.post('/mutation', data: {'turn': 'old'}),
    );
    await flush(t);
    client.invalidateLogin();
    auth.select(null);
    auth.select(a);
    old.complete(status(200));
    await flush(t);
    await done;
    expect((result.error as DioException).type, DioExceptionType.cancel);
    expect(transport.sent, hasLength(1));
    client.dio.httpClientAdapter = Transport((_) async => status(200));
    final next = Result();
    final nextDone = next.observe(
      client.dio.post('/mutation', data: {'turn': 'new'}),
    );
    await flush(t);
    await nextDone;
    expect(next.response?.statusCode, 200);
  });

  testWidgets(
    'local logout fences outgoing user even before remote signOut finishes',
    (t) async {
      final first = Result();
      final f = first.observe(client.dio.get('/first'));
      await flush(t);
      await f;
      client.invalidateLogin();
      final result = Result();
      final done = result.observe(client.dio.post('/mutation'));
      await flush(t);
      await done;
      expect((result.error as DioException).type, DioExceptionType.cancel);
      expect(transport.sent, hasLength(1));
    },
  );

  for (final force in [false, true]) {
    testWidgets(
      '${force ? 'refresh' : 'initial'} unresolved token times out; late token never dispatches',
      (t) async {
        final token = Completer<String?>();
        when(() => a.getIdToken(force)).thenAnswer((_) {
          if (force) refreshes++;
          return token.future;
        });
        transport = Transport((_) async => status(force ? 401 : 200));
        client.dio.httpClientAdapter = transport;
        final result = Result();
        final done = result.observe(
          client.dio.post('/mutation', data: {'turn': 'id'}),
        );
        await flush(t);
        expect(result.settled, false);
        await t.pump(DioClient.tokenDeadline);
        await flush(t);
        await done;
        expect(result.settled, true);
        expect(result.error, isA<DioException>());
        expect(
          (result.error as DioException).error,
          isA<HttpAuthenticationFailure>(),
        );
        expect(DioClient.isPermanentAuthenticationError(result.error!), false);
        expect(transport.sent, hasLength(force ? 1 : 0));
        token.complete('late');
        await flush(t);
        expect(transport.sent, hasLength(force ? 1 : 0));
      },
    );

    testWidgets(
      '${force ? 'refresh' : 'initial'} token work cancelled by logout',
      (t) async {
        final token = Completer<String?>();
        when(() => a.getIdToken(force)).thenAnswer((_) => token.future);
        transport = Transport((_) async => status(401));
        client.dio.httpClientAdapter = transport;
        final result = Result();
        final done = result.observe(client.dio.post('/mutation'));
        await flush(t);
        client.invalidateLogin();
        auth.select(null);
        auth.select(a);
        await flush(t);
        await done;
        expect((result.error as DioException).type, DioExceptionType.cancel);
        token.complete('obsolete');
        await flush(t);
        expect(transport.sent, hasLength(force ? 1 : 0));
      },
    );
  }

  testWidgets('caller cancellation before token returns prevents late send', (
    t,
  ) async {
    final token = Completer<String?>();
    when(() => a.getIdToken(false)).thenAnswer((_) => token.future);
    final cancel = CancelToken(), result = Result();
    final done = result.observe(
      client.dio.post('/mutation', cancelToken: cancel),
    );
    await flush(t);
    cancel.cancel();
    await flush(t);
    await done;
    token.complete('late');
    await flush(t);
    expect(transport.sent, isEmpty);
    expect((result.error as DioException).type, DioExceptionType.cancel);
  });

  testWidgets(
    'same-login 401 replays original body and idempotency once; no retry header',
    (t) async {
      transport = Transport(
        (o) async => status(
          o.headers['Authorization'] == 'Bearer A-refreshed' ? 200 : 401,
        ),
      );
      client.dio.httpClientAdapter = transport;
      final body = {'clientTurnId': 'stable', 'text': 'retained answer'};
      final result = Result();
      final done = result.observe(
        client.dio.post(
          '/mutation',
          data: body,
          options: Options(headers: {'Idempotency-Key': 'stable'}),
        ),
      );
      await flush(t);
      await done;
      expect(result.response?.statusCode, 200);
      expect(refreshes, 1);
      expect(transport.sent, hasLength(2));
      for (final sent in transport.sent) {
        expect(sent['body'], same(body));
        expect(sent['headers']['Idempotency-Key'], 'stable');
        expect(sent['headers'].containsKey('_retry'), false);
      }
    },
  );

  testWidgets('second 401 terminates with no second refresh', (t) async {
    transport = Transport((_) async => status(401));
    client.dio.httpClientAdapter = transport;
    final result = Result();
    final done = result.observe(client.dio.post('/mutation'));
    await flush(t);
    await done;
    expect((result.error as DioException).response?.statusCode, 401);
    expect(refreshes, 1);
    expect(transport.sent, hasLength(2));
  });

  testWidgets(
    'simultaneous and staggered 401s coalesce a login-scoped refresh',
    (t) async {
      final token = Completer<String?>(), slow401 = Completer<ResponseBody>();
      when(() => a.getIdToken(true)).thenAnswer((_) {
        refreshes++;
        return token.future;
      });
      transport = Transport((o) async {
        if (o.headers['Authorization'] == 'Bearer refreshed') {
          return status(200);
        }
        if (o.path == '/slow') {
          return slow401.future;
        }
        return status(401);
      });
      client.dio.httpClientAdapter = transport;
      final results = [Result(), Result(), Result()];
      final requests = [
        results[0].observe(client.dio.post('/one')),
        results[1].observe(client.dio.post('/two')),
        results[2].observe(client.dio.post('/slow')),
      ];
      await flush(t);
      expect(refreshes, 1);
      token.complete('refreshed');
      await flush(t);
      slow401.complete(status(401));
      await flush(t);
      await Future.wait(requests);
      expect(refreshes, 1);
      expect(transport.sent, hasLength(6));
      expect(results.every((r) => r.response?.statusCode == 200), true);
    },
  );

  for (final code in ['user-disabled', 'network-request-failed']) {
    testWidgets(
      '$code is classified; transient can recover on a new bounded attempt',
      (t) async {
        when(
          () => a.getIdToken(false),
        ).thenAnswer((_) async => throw FirebaseAuthException(code: code));
        final result = Result();
        final done = result.observe(client.dio.post('/mutation'));
        await flush(t);
        await done;
        expect(
          DioClient.isPermanentAuthenticationError(result.error!),
          code == 'user-disabled',
        );
        expect(transport.sent, isEmpty);
        when(() => a.getIdToken(false)).thenAnswer((_) async => 'recovered');
        final next = Result();
        final nextDone = next.observe(client.dio.get('/next'));
        await flush(t);
        await nextDone;
        expect(next.response?.statusCode, 200);
      },
    );
  }
  for (final value in <String?>[null, '', ' ']) {
    testWidgets('empty credential ($value) is rejected permanently', (t) async {
      when(() => a.getIdToken(false)).thenAnswer((_) async => value);
      final result = Result();
      final done = result.observe(client.dio.post('/mutation'));
      await flush(t);
      await done;
      expect(DioClient.isPermanentAuthenticationError(result.error!), true);
      expect(transport.sent, isEmpty);
    });
  }
  testWidgets(
    'anonymous endpoint remains anonymous and cannot refresh into a login',
    (t) async {
      auth.select(null);
      transport = Transport((_) async => status(401));
      client.dio.httpClientAdapter = transport;
      final result = Result();
      final done = result.observe(
        client.dio.post('/auth/login', data: {'email': 'test'}),
      );
      await flush(t);
      await done;
      expect(transport.sent, hasLength(1));
      expect(
        transport.sent.single['headers'].containsKey('Authorization'),
        false,
      );
      expect(refreshes, 0);
    },
  );

  testWidgets(
    'logout before first HTTP request blocks the still-signed-in user',
    (t) async {
      client.invalidateLogin(uid: 'A');
      final result = Result();
      final done = result.observe(client.dio.post('/mutation'));
      await flush(t);
      await done;
      expect((result.error as DioException).type, DioExceptionType.cancel);
      expect(transport.sent, isEmpty);
    },
  );

  testWidgets(
    'account switch during refresh cannot send A body with B credentials',
    (t) async {
      final token = Completer<String?>();
      when(() => a.getIdToken(true)).thenAnswer((_) => token.future);
      transport = Transport((_) async => status(401));
      client.dio.httpClientAdapter = transport;
      final result = Result();
      final done = result.observe(
        client.dio.post('/mutation', data: {'draft': 'A'}),
      );
      await flush(t);
      auth.select(b);
      await flush(t);
      await done;
      expect((result.error as DioException).type, DioExceptionType.cancel);
      token.complete('A-late-refresh');
      await flush(t);
      expect(transport.sent, hasLength(1));
      verifyNever(() => b.getIdToken(true));
      transport = Transport((_) async => status(200));
      client.dio.httpClientAdapter = transport;
      final next = Result();
      final nextDone = next.observe(
        client.dio.post('/mutation', data: {'draft': 'B'}),
      );
      await flush(t);
      await nextDone;
      expect(next.response?.statusCode, 200);
      expect(
        transport.sent.single['headers']['Authorization'],
        'Bearer B-initial',
      );
      expect(transport.sent.single['body'], {'draft': 'B'});
    },
  );

  testWidgets(
    'logout cancels the remaining request when another shared-token request finished',
    (t) async {
      final reply = Completer<ResponseBody>();
      transport = Transport(
        (o) async => o.path == '/fast' ? status(200) : reply.future,
      );
      client.dio.httpClientAdapter = transport;
      final shared = CancelToken(), first = Result(), second = Result();
      final firstDone = first.observe(
        client.dio.post('/fast', cancelToken: shared),
      );
      final secondDone = second.observe(
        client.dio.post('/slow', cancelToken: shared),
      );
      await flush(t);
      await firstDone;
      expect(second.settled, false);
      auth.select(b);
      await flush(t);
      expect(shared.isCancelled, true);
      await secondDone;
      expect((second.error as DioException).type, DioExceptionType.cancel);
      reply.complete(status(200));
      await flush(t);
      expect(transport.sent, hasLength(2));
      verifyNever(() => b.getIdToken(false));
    },
  );

  testWidgets(
    'analysis polling cannot resume an old job in a new same-UID login',
    (t) async {
      transport = Transport(
        (_) async => ResponseBody.fromString(
          '{"data":{"jobId":"A-job"}}',
          202,
          headers: {
            Headers.contentTypeHeader: ['application/json'],
          },
        ),
      );
      client.dio.httpClientAdapter = transport;
      final result = Result();
      final done = result.observe(
        client.postAnalysis('/analysis', data: {'draft': 'A'}),
      );
      await flush(t);
      client.invalidateLogin();
      auth.select(null);
      auth.select(a);
      await t.pump(const Duration(seconds: 2));
      await flush(t);
      await done;
      expect((result.error as DioException).type, DioExceptionType.cancel);
      expect(transport.sent, hasLength(1));
    },
  );
}
