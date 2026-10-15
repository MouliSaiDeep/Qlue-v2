import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';
// firebase_auth also exports an `AuthProvider` (the OAuth provider base class);
// hide it so the unqualified name resolves to our app provider below.
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:frontend/core/network/dio_client.dart';
import 'package:frontend/core/network/websocket_client.dart';
import 'package:frontend/shared/services/stt_service.dart';
import 'package:frontend/shared/services/tts_service.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';

// Finding 7 (account isolation) acceptance suite: proves that on every UID
// transition (logout -> null, or an A->B account switch) each user-data
// provider drops the previous account's data, and that a slow/failed/delayed
// response captured under the old account can never repaint the new one.

class MockFirebaseAuth extends Mock implements FirebaseAuth {}

class MockGoogleSignIn extends Mock implements GoogleSignIn {}

class MockUser extends Mock implements User {}

class MockDeletionUserInfo extends Mock implements UserInfo {}

class MockDeletionCredential extends Mock implements UserCredential {}

void deletionCredentials(MockUser user) {
  final info = MockDeletionUserInfo();
  when(() => info.providerId).thenReturn('password');
  when(() => user.providerData).thenReturn([info]);
  when(() => user.email).thenReturn('synthetic@example.test');
  when(
    () => user.reauthenticateWithCredential(any()),
  ).thenAnswer((_) async => MockDeletionCredential());
  when(
    () => user.getIdToken(true),
  ).thenAnswer((_) async => 'synthetic-fresh-token');
}

// R-09 fakes: override only the PUBLIC surface InterviewProvider touches so the
// provider's real multi-step flows and their generation guards run under test,
// without opening a real socket, mic, or audio player. Each base constructor
// runs (SpeechToText()/AudioPlayer()/StreamControllers), which the existing
// InterviewProvider tests already prove is safe in the test binding.
class FakeStt extends SttService {
  void Function(String)? onPartialCb;
  void Function(String)? onFinalCb;
  bool _listening = false;
  Timer? _fakeEndpoint;
  void Function()? endpoint;
  void Function(bool)? activity;
  bool _speechDetected = false;
  String _lastFakeHypothesis = '';
  int _fakeCapture = 0;
  @override
  bool get stableTranscript => false;
  @override
  bool get heardSpeech => _speechDetected;
  @override
  void configureCapture({
    required String identity,
    required bool preserve,
    required void Function(bool) onActivity,
    required void Function() onEndpoint,
  }) {
    activity = onActivity;
    endpoint = onEndpoint;
    if (!preserve) _speechDetected = false;
  }

  // A fake AUDIO endpoint for orchestration tests only. Real detector checks
  // use recorded PCM through SpeechEngine; text is not a production trigger.
  void _audioSpeech(String text) {
    if (text == _lastFakeHypothesis) return;
    _lastFakeHypothesis = text;
    _speechDetected = true;
    activity?.call(true);
    _fakeEndpoint?.cancel();
    _fakeEndpoint = Timer(const Duration(seconds: 40), () => endpoint?.call());
  }

  @override
  Future<bool> init({
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async => true;

  @override
  bool get isListening => _listening;

  @override
  Future<void> startListening({
    required Function(String) onPartial,
    required Function(String) onFinal,
    Function(SpeechRecognitionError)? onError,
    Function(String)? onStatus,
  }) async {
    final capture = ++_fakeCapture;
    _lastFakeHypothesis = '';
    onPartialCb = (text) {
      if (capture == _fakeCapture) _audioSpeech(text);
      onPartial(text);
    };
    onFinalCb = (text) {
      if (capture == _fakeCapture) _audioSpeech(text);
      onFinal(text);
    };
    _listening = true;
    _fakeEndpoint?.cancel();
    _fakeEndpoint = Timer(const Duration(seconds: 40), () => endpoint?.call());
  }

  @override
  void stop() {
    _fakeCapture++;
    _listening = false;
    _fakeEndpoint?.cancel();
  }

  @override
  void clearCapture() {
    stop();
  }

  @override
  Future<void> stopCapture() async {
    stop();
  }

  @override
  Future<void> stopCaptureAndFlush() => stopCapture();

  @override
  Future<void> reInitialize() async {}
}

class FakeTts extends TtsService {
  @override
  Future<void> playUrl(String url) async {}

  @override
  Future<void> playBase64(String base64Data) async {}

  @override
  Future<void> stop() async {}

  @override
  void dispose() {}
}

class FakeWs extends WebSocketClient {
  FakeWs({super.url = 'wss://fake', super.userId = 'u', super.sessionId = 's'});

  int connectCalls = 0;
  @override
  bool get isConnected => true;
  int disconnectCalls = 0;
  final List<Map<String, dynamic>> sentMessages = [];
  Completer<void>? connectGate; // when set, connect() parks until released

  void releaseConnect() {
    if (connectGate != null && !connectGate!.isCompleted) {
      connectGate!.complete();
    }
  }

  @override
  Future<void> connect({String? authToken}) async {
    connectCalls++;
    if (connectGate != null) await connectGate!.future;
  }

  @override
  Future<void> waitForConnection() async {}

  @override
  void sendMessage(Map<String, dynamic> message) {
    sentMessages.add(message);
  }

  @override
  void disconnect() {
    disconnectCalls++;
  }
}

/// Replaces any request interceptor on the shared Dio singleton with [onRequest].
/// All service classes read `DioClient().dio`, so this is the single seam the
/// tests drive. Callers must resolve/reject or pass through every request.
void _install(
  void Function(RequestOptions, RequestInterceptorHandler) onRequest,
) {
  DioClient().dio.interceptors.clear();
  DioClient().dio.interceptors.add(InterceptorsWrapper(onRequest: onRequest));
}

void main() {
  // AuthProvider/InterviewProvider constructors touch platform channels, so the
  // test binding must exist before any provider is built.
  TestWidgetsFlutterBinding.ensureInitialized();
  registerFallbackValue(
    EmailAuthProvider.credential(
      email: 'synthetic@example.test',
      password: 'test-only',
    ),
  );

  tearDown(() {
    DioClient().dio.interceptors.clear();
  });

  group('InterviewProvider account isolation', () {
    setUp(() {
      // _cleanup() -> SttService.stop() invokes the speech_to_text channel;
      // swallow it so resetForUser is inert under test.
      const channel = MethodChannel('plugin.csdcorp.com/speech_to_text');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);
    });

    test(
      'resetForUser clears session state and is safe with no active session',
      () {
        final p = InterviewProvider();
        p.sessionId = 'sess-A';
        p.moduleType = 'RESUME';
        p.transcript.add(
          TranscriptEntry(role: 'AI', text: 'hi', timestamp: DateTime.now()),
        );
        p.subtitleText = 'streaming';

        p.resetForUser('B');

        expect(p.sessionId, isNull);
        expect(p.transcript, isEmpty);
        expect(p.moduleType, isNull);
        expect(p.currentPhase, InterviewPhase.ready);
        expect(p.isSessionEnded, isFalse);
        p.dispose();
      },
    );

    test('a late STT final belonging to A is dropped after switch to B', () {
      final stt = FakeStt();
      final p = InterviewProvider(sttService: stt, ttsService: FakeTts());
      p.resetForNewSession(); // new session epoch; _isEnding=false
      p.debugStartListening(); // real _startListening captures callbacks @ this gen
      expect(stt.onFinalCb, isNotNull);

      p.resetForUser('B'); // A->B: generation++ (captured gen now stale)

      // Native STT delivers A's answer after the switch — it must be dropped,
      // not submitted into B's transcript nor advanced into processing.
      stt.onFinalCb!('answer spoken under account A');

      expect(p.transcript, isEmpty);
      expect(p.finalTranscript, isNot('answer spoken under account A'));
      expect(p.currentPhase, InterviewPhase.ready);
      p.dispose();
    });

    test(
      'A -> logout -> A produces a distinct generation at every transition',
      () {
        final p = InterviewProvider(
          sttService: FakeStt(),
          ttsService: FakeTts(),
        );
        final seen = <int>{p.generation};
        p.resetForUser('A');
        seen.add(p.generation); // sign in as A
        p.resetForNewSession();
        seen.add(p.generation); // start a session
        p.resetForUser(null);
        seen.add(p.generation); // log out
        p.resetForUser('A');
        seen.add(p.generation); // sign back in as A
        p.resetForNewSession();
        seen.add(p.generation); // start a new session
        // Six epochs, six distinct generations: a callback captured in A's first
        // session can never match A's second one (the A->logout->A case).
        expect(seen.length, 6);
        p.dispose();
      },
    );

    test(
      "A's in-flight interview init opens no socket or session for B",
      () async {
        final auth = MockFirebaseAuth();
        final user = MockUser();
        when(() => auth.currentUser).thenReturn(user);
        when(() => user.uid).thenReturn('A');
        when(() => user.getIdToken()).thenAnswer((_) async => 'tokenA');

        var wsFactoryCalls = 0;
        _install((options, handler) {
          if (options.path.contains('/interview/init')) {
            handler.resolve(
              Response(
                requestOptions: options,
                statusCode: 200,
                data: {'sessionId': 'sess-A'},
              ),
            );
          } else {
            handler.next(options);
          }
        });

        final p = InterviewProvider(
          sttService: FakeStt(),
          ttsService: FakeTts(),
          auth: auth,
          wsFactory:
              ({
                required String url,
                required String userId,
                required String sessionId,
              }) {
                wsFactoryCalls++;
                return FakeWs();
              },
        );

        final pending = p.initSession('HR'); // captures gen, awaits stt.init
        p.resetForUser('B'); // A->B while init is parked on its first await
        await pending; // init resumes, hits the first guard, aborts

        expect(wsFactoryCalls, 0); // no socket ever constructed for B
        expect(p.sessionId, isNull); // A's sessionId never adopted into B
        expect(p.isConnecting, isFalse);
        p.dispose();
      },
    );

    test("a switch while A's socket is connecting tears it down and sends no "
        'session_init', () async {
      final auth = MockFirebaseAuth();
      final user = MockUser();
      when(() => auth.currentUser).thenReturn(user);
      when(() => user.uid).thenReturn('A');
      when(() => user.getIdToken()).thenAnswer((_) async => 'tokenA');

      final fakeWs = FakeWs()..connectGate = Completer<void>();
      _install((options, handler) {
        if (options.path.contains('/interview/init')) {
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: {'sessionId': 'sess-A'},
            ),
          );
        } else {
          handler.next(options);
        }
      });

      final p = InterviewProvider(
        sttService: FakeStt(),
        ttsService: FakeTts(),
        auth: auth,
        wsFactory:
            ({
              required String url,
              required String userId,
              required String sessionId,
            }) => fakeWs,
      );

      final pending = p.initSession('HR');
      // Let init run under A all the way to the gated connect().
      await Future.delayed(const Duration(milliseconds: 50));
      expect(fakeWs.connectCalls, 1); // reached connect() under A

      p.resetForUser('B'); // switch while parked inside connect()
      fakeWs.releaseConnect(); // connect resolves -> stale -> teardown
      await pending;

      expect(fakeWs.sentMessages, isEmpty); // session_init never sent for B
      expect(
        fakeWs.disconnectCalls,
        greaterThanOrEqualTo(1),
      ); // socket torn down
      expect(p.sessionId, isNull); // reset cleared it; init did not restore it
      expect(p.isConnecting, isFalse);
      p.dispose();
    });
  });
}
