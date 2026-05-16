import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
<<<<<<< HEAD
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/context/auth_provider.dart' as app_auth;
import 'package:frontend/shared/services/stt_service.dart';
import 'package:frontend/shared/services/tts_service.dart';
import 'package:frontend/core/network/websocket_client.dart';
import 'package:frontend/screens/interview/interview_session_screen.dart';
import 'package:frontend/core/theme.dart';

class MockSttService extends Mock implements SttService {}
class MockTtsService extends Mock implements TtsService {}
class MockDio extends Mock implements Dio {}
class MockFirebaseAuth extends Mock implements FirebaseAuth {}
class MockUser extends Mock implements User {}
class MockGoogleSignIn extends Mock implements GoogleSignIn {}
class MockWebSocketClient extends Mock implements WebSocketClient {}

void main() {
  late MockSttService mockStt;
  late MockTtsService mockTts;
  late MockDio mockDio;
  late MockFirebaseAuth mockAuth;
  late MockUser mockUser;
  late MockGoogleSignIn mockGoogleSignIn;
  late MockWebSocketClient mockWS;
  late InterviewProvider interviewProvider;
  late app_auth.AuthProvider authProvider;

  setUp(() {
    mockStt = MockSttService();
    mockTts = MockTtsService();
    mockDio = MockDio();
    mockAuth = MockFirebaseAuth();
    mockUser = MockUser();
    mockGoogleSignIn = MockGoogleSignIn();
    mockWS = MockWebSocketClient();
    
    when(() => mockAuth.authStateChanges()).thenAnswer((_) => Stream.value(null));
    when(() => mockAuth.currentUser).thenReturn(mockUser);
    when(() => mockUser.uid).thenReturn('user123');
    when(() => mockUser.getIdToken()).thenAnswer((_) async => 'token123');
    
    authProvider = app_auth.AuthProvider(
      auth: mockAuth,
      googleSignIn: mockGoogleSignIn,
      dio: mockDio,
    );

    interviewProvider = InterviewProvider(
      sttService: mockStt,
      ttsService: mockTts,
      dio: mockDio,
      auth: mockAuth,
      wsClientFactory: (url, userId, sessionId) => mockWS,
    );

    // Default mock behavior
    when(() => mockWS.messages).thenAnswer((_) => const Stream.empty());
    when(() => mockWS.errors).thenAnswer((_) => const Stream.empty());
    when(() => mockWS.disconnects).thenAnswer((_) => const Stream.empty());
    when(() => mockWS.reconnects).thenAnswer((_) => const Stream.empty());
    when(() => mockStt.stop()).thenAnswer((_) async => {});
    when(() => mockTts.stop()).thenAnswer((_) async => {});
    when(() => mockStt.init()).thenAnswer((_) async => true);
=======
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/context/auth_provider.dart' as app_auth;
import 'package:frontend/screens/interview/interview_session_screen.dart';
import 'package:frontend/core/theme.dart';

class MockInterviewProvider extends Mock implements InterviewProvider {}
class MockAuthProvider extends Mock implements app_auth.AuthProvider {}

void main() {
  late MockInterviewProvider mockInterviewProvider;
  late MockAuthProvider mockAuthProvider;

  setUp(() {
    mockInterviewProvider = MockInterviewProvider();
    mockAuthProvider = MockAuthProvider();
    
    // AuthProvider mocks
    when(() => mockAuthProvider.isAuthenticated).thenReturn(true);
    when(() => mockAuthProvider.isInitializing).thenReturn(false);
    when(() => mockAuthProvider.voiceId).thenReturn('Tiffany');
    
    // InterviewProvider mocks
    when(() => mockInterviewProvider.sessionId).thenReturn('s1');
    when(() => mockInterviewProvider.moduleType).thenReturn('HR');
    when(() => mockInterviewProvider.currentPhase).thenReturn(InterviewPhase.ready);
    when(() => mockInterviewProvider.isConnecting).thenReturn(false);
    when(() => mockInterviewProvider.isListening).thenReturn(false);
    when(() => mockInterviewProvider.isSessionEnded).thenReturn(false);
    when(() => mockInterviewProvider.isStreamingText).thenReturn(false);
    when(() => mockInterviewProvider.subtitleText).thenReturn('');
    when(() => mockInterviewProvider.finalQuestionText).thenReturn('');
    when(() => mockInterviewProvider.questionText).thenReturn('Hello, tell me about yourself.');
    when(() => mockInterviewProvider.partialTranscript).thenReturn('');
    when(() => mockInterviewProvider.finalTranscript).thenReturn('');
    when(() => mockInterviewProvider.silenceStrikes).thenReturn(0);
    
    // Methods
    when(() => mockInterviewProvider.resetForNewSession()).thenReturn(null);
    when(() => mockInterviewProvider.setVoice(any(), engine: any(named: 'engine'))).thenReturn(null);
    when(() => mockInterviewProvider.initSession(any(), resumeId: any(named: 'resumeId'), websiteUrl: any(named: 'websiteUrl')))
        .thenAnswer((_) async => {});
    
    // Listeners
    when(() => mockInterviewProvider.addListener(any())).thenReturn(null);
    when(() => mockInterviewProvider.removeListener(any())).thenReturn(null);
    when(() => mockInterviewProvider.hasListeners).thenReturn(false);
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
  });

  Widget createTestWidget(Widget child) {
    return AppThemeColorsProvider(
      colors: AppThemeColors.dark,
      child: MultiProvider(
        providers: [
<<<<<<< HEAD
          ChangeNotifierProvider<app_auth.AuthProvider>.value(value: authProvider),
          ChangeNotifierProvider<InterviewProvider>.value(value: interviewProvider),
=======
          ChangeNotifierProvider<app_auth.AuthProvider>.value(value: mockAuthProvider),
          ChangeNotifierProvider<InterviewProvider>.value(value: mockInterviewProvider),
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
        ],
        child: MaterialApp(
          home: child,
        ),
      ),
    );
  }

  group('Interview Flow Tests', () {
    testWidgets('Interview Session - Basic Initialization', (WidgetTester tester) async {
<<<<<<< HEAD
      interviewProvider.sessionId = 's1';
      interviewProvider.moduleType = 'HR';

      await tester.pumpWidget(createTestWidget(const InterviewSessionScreen()));
      await tester.pump(); // Handle post-frame callback
=======
      await tester.pumpWidget(createTestWidget(const InterviewSessionScreen()));
      await tester.pumpAndSettle();
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66

      expect(find.text('INTERVIEW MODE'), findsOneWidget);
      expect(find.byType(InterviewSessionScreen), findsOneWidget);
    });
  });
}
