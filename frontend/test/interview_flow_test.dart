import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
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
  });

  Widget createTestWidget(Widget child) {
    return AppThemeColorsProvider(
      colors: AppThemeColors.dark,
      child: MultiProvider(
        providers: [
          ChangeNotifierProvider<app_auth.AuthProvider>.value(value: mockAuthProvider),
          ChangeNotifierProvider<InterviewProvider>.value(value: mockInterviewProvider),
        ],
        child: MaterialApp(
          home: child,
        ),
      ),
    );
  }

  group('Interview Flow Tests', () {
    testWidgets('Interview Session - Basic Initialization', (WidgetTester tester) async {
      await tester.pumpWidget(createTestWidget(const InterviewSessionScreen()));
      await tester.pumpAndSettle();

      expect(find.text('INTERVIEW MODE'), findsOneWidget);
      expect(find.byType(InterviewSessionScreen), findsOneWidget);
    });
  });
}
