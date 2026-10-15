import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../constants/api_constants.dart';

/// Local classification; provider details and credentials are never logged.
class HttpAuthenticationFailure implements Exception {
  const HttpAuthenticationFailure(this.retryable);
  final bool retryable;
  @override
  String toString() => retryable
      ? 'Authentication temporarily unavailable. Please retry.'
      : 'Please sign in again.';
}

class _Login {
  _Login(this.user, this.generation) : uid = user?.uid;
  final User? user;
  final String? uid;
  final int generation;
  final ended = Completer<void>();
  final requests = <CancelToken, int>{};
  Future<String>? refresh;
  String? refreshedToken;
  int credentialVersion = 0;
}

class _RequestLogin {
  _RequestLogin(this.login);
  final _Login login;
  int credentialVersion = 0;
  bool replayed = false;
}

/// Stamp ownership synchronously, before Dio queues any interceptor work.
class _OwnedDio extends DioMixin implements Dio {
  _OwnedDio(
    BaseOptions base,
    this.bind,
    this.finish,
    this.verify,
    this.active,
  ) {
    options = base;
    httpClientAdapter = Dio().httpClientAdapter;
  }
  final void Function(RequestOptions) bind;
  final void Function(RequestOptions) finish;
  final void Function(RequestOptions) verify;
  final bool Function() active;
  @override
  Future<Response<T>> fetch<T>(RequestOptions requestOptions) async {
    final guarded = active();
    if (guarded) bind(requestOptions);
    try {
      final response = await super.fetch<T>(requestOptions);
      if (guarded) verify(requestOptions);
      return response;
    } finally {
      if (guarded) finish(requestOptions);
    }
  }
}

class DioClient {
  static final DioClient _instance = DioClient._(() => FirebaseAuth.instance);
  factory DioClient() => _instance;
  DioClient.withAuth(FirebaseAuth auth) : this._(() => auth);
  static const tokenDeadline = Duration(seconds: 10);
  static const _ownerKey = 'qlue.requestLogin';
  final FirebaseAuth Function() _auth;
  late final Dio _dio;
  late final Interceptor _authentication;
  StreamSubscription<User?>? _subscription;
  _Login? _login;
  int _generation = 0;
  bool _locallySignedOut = false;
  String? _blockedUid;
  Dio get dio => _dio;

  static bool isPermanentAuthenticationError(Object error) =>
      error is DioException &&
      error.error is HttpAuthenticationFailure &&
      !(error.error as HttpAuthenticationFailure).retryable;

  void _observe(User? user) {
    if (_locallySignedOut && user?.uid != _blockedUid) {
      _locallySignedOut = false;
    }
    if (_login != null && _login!.uid == user?.uid) return;
    _endLogin();
    _login = _Login(user, ++_generation);
  }

  void _endLogin() {
    final old = _login;
    _login = null;
    if (old == null) return;
    old.ended.complete();
    for (final cancel in old.requests.keys.toList()) {
      if (!cancel.isCancelled) {
        cancel.cancel('Login changed');
      }
    }
  }

  /// Invalidate before remote sign-out, even when Firebase sign-out fails.
  void invalidateLogin({String? uid}) {
    _blockedUid = uid ?? _login?.uid;
    _locallySignedOut = _blockedUid != null;
    _endLogin();
    ++_generation;
  }

  _Login _capture() {
    final auth = _auth();
    _subscription ??= auth.authStateChanges().listen(_observe);
    _observe(auth.currentUser);
    if (_locallySignedOut) throw StateError('Login ended');
    return _login!;
  }

  void _check(RequestOptions options) {
    final owner = options.extra[_ownerKey] as _RequestLogin;
    _observe(_auth().currentUser);
    if (_locallySignedOut ||
        !identical(owner.login, _login) ||
        owner.login.generation != _generation ||
        options.cancelToken?.isCancelled == true) {
      throw _cancelled(options);
    }
  }

  DioException _cancelled(RequestOptions options) => DioException(
    requestOptions: options,
    type: DioExceptionType.cancel,
    message: 'Request cancelled because its login ended.',
  );

  void _bind(RequestOptions options) {
    if (!options.extra.containsKey(_ownerKey)) {
      try {
        options.extra[_ownerKey] = _RequestLogin(_capture());
      } catch (_) {
        throw _cancelled(options);
      }
    }
    _check(options);
    options.cancelToken ??= CancelToken();
    options.cancelToken!.requestOptions ??= options;
    (options.extra[_ownerKey] as _RequestLogin).login.requests.update(
      options.cancelToken!,
      (count) => count + 1,
      ifAbsent: () => 1,
    );
  }

  void _finish(RequestOptions options) {
    final requests =
        (options.extra[_ownerKey] as _RequestLogin?)?.login.requests;
    final token = options.cancelToken;
    if (requests == null || token == null) return;
    final count = requests[token];
    if (count == null) return;
    if (count > 1) {
      requests[token] = count - 1;
    } else {
      requests.remove(token);
    }
  }

  Future<String> _token(_Login login, bool force, [CancelToken? cancel]) async {
    final deadline = Completer<String?>();
    final timer = Timer(
      tokenDeadline,
      () => deadline.completeError(TimeoutException('Token deadline')),
    );
    try {
      final value = await Future.any<String?>([
        login.user!.getIdToken(force),
        deadline.future,
        login.ended.future.then<String?>(
          (_) => throw StateError('Login ended'),
        ),
        if (cancel != null)
          cancel.whenCancel.then<String?>((error) => throw error),
      ]);
      if (value == null || value.trim().isEmpty) {
        throw const HttpAuthenticationFailure(false);
      }
      return value;
    } on FirebaseAuthException catch (e) {
      throw HttpAuthenticationFailure(
        !{
          'user-disabled',
          'user-not-found',
          'invalid-user-token',
          'user-token-expired',
          'invalid-credential',
          'invalid-refresh-token',
        }.contains(e.code),
      );
    } on HttpAuthenticationFailure {
      rethrow;
    } catch (_) {
      throw const HttpAuthenticationFailure(true);
    } finally {
      timer.cancel();
    }
  }

  Future<String> _refresh(_Login login) {
    return login.refresh ??= () async {
      try {
        final token = await _token(login, true);
        if (!identical(login, _login) || login.ended.isCompleted) {
          throw StateError('Login ended');
        }
        login.refreshedToken = token;
        login.credentialVersion++;
        return token;
      } finally {
        login.refresh = null;
      }
    }();
  }

  DioException _failure(RequestOptions options, Object error) =>
      error is DioException
      ? error
      : DioException(
          requestOptions: options,
          error: error is HttpAuthenticationFailure
              ? error
              : const HttpAuthenticationFailure(true),
          message: error is HttpAuthenticationFailure
              ? error.toString()
              : 'Authentication temporarily unavailable. Please retry.',
        );

  DioClient._(this._auth) {
    _dio = _OwnedDio(
      BaseOptions(
        baseUrl: ApiConstants.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 60),
        headers: {'X-Qlue-Protocol': '2'},
      ),
      _bind,
      _finish,
      _check,
      () => _dio.interceptors.contains(_authentication),
    );
    _authentication = InterceptorsWrapper(
      onRequest: (options, handler) async {
        try {
          _check(options);
          final owner = options.extra[_ownerKey] as _RequestLogin;
          if (owner.login.user != null && !owner.replayed) {
            final version = owner.login.credentialVersion;
            final token = await _token(owner.login, false, options.cancelToken);
            _check(options);
            owner.credentialVersion = version;
            options.headers['Authorization'] = 'Bearer $token';
          }
          _check(options);
          handler.next(options);
        } catch (error) {
          try {
            _check(options);
            handler.reject(_failure(options, error));
          } catch (stale) {
            handler.reject(_failure(options, stale));
          }
        }
      },
      onResponse: (response, handler) {
        try {
          _check(response.requestOptions);
          handler.next(response);
        } catch (error) {
          handler.reject(_failure(response.requestOptions, error));
        }
      },
      onError: (error, handler) async {
        if (error.type == DioExceptionType.cancel) {
          handler.next(error);
          return;
        }
        final options = error.requestOptions;
        try {
          _check(options);
          final owner = options.extra[_ownerKey] as _RequestLogin;
          if (error.response?.statusCode != 401 ||
              owner.replayed ||
              owner.login.user == null) {
            handler.next(error);
            return;
          }
          owner.replayed = true;
          final login = owner.login;
          // Staggered 401s for an older credential also share a completed refresh.
          final token = owner.credentialVersion < login.credentialVersion
              ? login.refreshedToken!
              : await _refresh(login);
          _check(options);
          options.headers['Authorization'] = 'Bearer $token';
          if (options.data is FormData) {
            options.data = (options.data as FormData).clone();
          }
          // Consumed arbitrary streams cannot safely be replayed.
          if (options.data is Stream) {
            handler.next(error);
            return;
          }
          _check(options);
          handler.resolve(await _dio.fetch<dynamic>(options));
        } catch (failure) {
          handler.next(_failure(options, failure));
        }
      },
    );
    _dio.interceptors.add(_authentication);
  }

  Future<void> close() async {
    invalidateLogin();
    await _subscription?.cancel();
    _dio.close(force: true);
  }

  Future<Response<dynamic>> postAnalysis(
    String path, {
    required Object data,
  }) async {
    final response = await _dio.post(path, data: data);
    final owner = response.requestOptions.extra[_ownerKey];
    void check() {
      if (owner != null) _check(response.requestOptions);
    }

    check();
    if (response.statusCode != 202) return response;
    final jobId = response.data['data']?['jobId'];
    if (jobId is! String) throw StateError('Analysis request was not accepted');
    final until = DateTime.now().add(const Duration(minutes: 3));
    while (DateTime.now().isBefore(until)) {
      check();
      await Future<void>.delayed(const Duration(seconds: 2));
      check();
      final poll = await _dio.get(
        '/analysis/jobs/$jobId',
        options: Options(
          extra: {
            if (owner != null)
              _ownerKey: _RequestLogin((owner as _RequestLogin).login),
          },
        ),
      );
      check();
      final job = poll.data['data'];
      if (job['status'] == 'COMPLETE' || job['status'] == 'FAILED') {
        final result = job['result'];
        final body = result['body'];
        final completed = Response<dynamic>(
          requestOptions: response.requestOptions,
          statusCode: result['statusCode'],
          data: body is String ? jsonDecode(body) : body,
        );
        if ((completed.statusCode ?? 500) >= 400) {
          throw DioException(
            requestOptions: completed.requestOptions,
            response: completed,
            type: DioExceptionType.badResponse,
          );
        }
        return completed;
      }
    }
    throw StateError('Analysis is taking longer than expected. Retry later.');
  }
}
