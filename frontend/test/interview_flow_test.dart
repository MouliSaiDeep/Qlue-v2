import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
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
  });

  Widget createTestWidget(Widget child) {
    return AppThemeColorsProvider(
      colors: AppThemeColors.dark,
      child: MultiProvider(
        providers: [
          ChangeNotifierProvider<app_auth.AuthProvider>.value(value: authProvider),
          ChangeNotifierProvider<InterviewProvider>.value(value: interviewProvider),
        ],
        child: MaterialApp(
          home: child,
        ),
      ),
    );
  }

  group('Interview Flow Tests', () {
    testWidgets('Interview Session - Basic Initialization', (WidgetTester tester) async {
      interviewProvider.sessionId = 's1';
      interviewProvider.moduleType = 'HR';

      await tester.pumpWidget(createTestWidget(const InterviewSessionScreen()));
      await tester.pump(); // Handle post-frame callback

      expect(find.text('INTERVIEW MODE'), findsOneWidget);
      expect(find.byType(InterviewSessionScreen), findsOneWidget);
    });
  });
}
