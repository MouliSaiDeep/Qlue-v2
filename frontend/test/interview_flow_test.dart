import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/context/auth_provider.dart' as app_auth;
import 'package:frontend/context/appearance_provider.dart';
import 'package:frontend/screens/interview/interview_session_screen.dart';
import 'package:frontend/screens/interview/particle_sphere.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/shared/services/screen_awake_service.dart';

class SmokeAwakePort implements ScreenAwakePlatform {
  bool active = false;
  @override
  Future<void> setEnabled(bool value) async {
    active = value;
  }

  @override
  Future<bool> get enabled async => active;
}

class MockInterviewProvider extends Mock implements InterviewProvider {}

class MockAuthProvider extends Mock implements app_auth.AuthProvider {}

class MockAppearanceProvider extends Mock implements AppearanceProvider {}

void main() {
  late MockInterviewProvider mockInterviewProvider;
  late MockAuthProvider mockAuthProvider;
  late MockAppearanceProvider mockAppearanceProvider;

  setUp(() {
    mockInterviewProvider = MockInterviewProvider();
    mockAuthProvider = MockAuthProvider();
    mockAppearanceProvider = MockAppearanceProvider();
    when(() => mockAppearanceProvider.reduceMotion).thenReturn(true);
    when(() => mockAppearanceProvider.glassStyle).thenReturn('liquid');
    when(() => mockAppearanceProvider.isLiquid).thenReturn(true);
    when(() => mockAppearanceProvider.glassIntensity).thenReturn(1.0);

    // AuthProvider mocks
    when(() => mockAuthProvider.isAuthenticated).thenReturn(true);
    when(() => mockAuthProvider.isInitializing).thenReturn(false);
    when(() => mockAuthProvider.voiceId).thenReturn('Tiffany');
    when(() => mockAuthProvider.voiceMode).thenReturn('cost_saver');

    // InterviewProvider mocks
    when(() => mockInterviewProvider.sessionId).thenReturn('s1');
    when(() => mockInterviewProvider.moduleType).thenReturn('HR');
    when(
      () => mockInterviewProvider.currentPhase,
    ).thenReturn(InterviewPhase.ready);
    when(() => mockInterviewProvider.isConnecting).thenReturn(false);
    when(() => mockInterviewProvider.isListening).thenReturn(false);
    when(() => mockInterviewProvider.isSessionEnded).thenReturn(false);
    when(() => mockInterviewProvider.microphoneAvailable).thenReturn(true);
    when(() => mockInterviewProvider.hasPendingAnswer).thenReturn(false);
    when(() => mockInterviewProvider.sessionGeneration).thenReturn(1);
    when(() => mockInterviewProvider.needsScreenAwake).thenReturn(false);
    when(() => mockInterviewProvider.replayQuestionAvailable).thenReturn(false);
    when(() => mockInterviewProvider.canReplayQuestion).thenReturn(false);
    when(() => mockInterviewProvider.isStreamingText).thenReturn(false);
    when(() => mockInterviewProvider.isFinalizingTranscript).thenReturn(false);
    when(() => mockInterviewProvider.subtitleText).thenReturn('');
    when(() => mockInterviewProvider.finalQuestionText).thenReturn('');
    when(
      () => mockInterviewProvider.questionText,
    ).thenReturn('Hello, tell me about yourself.');
    when(() => mockInterviewProvider.partialTranscript).thenReturn('');
    when(() => mockInterviewProvider.finalTranscript).thenReturn('');
    when(() => mockInterviewProvider.silenceStrikes).thenReturn(0);

    // Methods
    when(() => mockInterviewProvider.resetForNewSession()).thenReturn(null);
    when(
      () => mockInterviewProvider.setVoice(
        any(),
        engine: any(named: 'engine'),
        voiceMode: any(named: 'voiceMode'),
      ),
    ).thenReturn(null);
    when(
      () => mockInterviewProvider.initSession(
        any(),
        resumeId: any(named: 'resumeId'),
        websiteUrl: any(named: 'websiteUrl'),
      ),
    ).thenAnswer((_) async => {});

    // Listeners
    when(() => mockInterviewProvider.addListener(any())).thenReturn(null);
    when(() => mockInterviewProvider.removeListener(any())).thenReturn(null);
  });

  Widget createTestWidget(Widget child) {
    return AppThemeColorsProvider(
      colors: AppThemeColors.dark,
      child: MultiProvider(
        providers: [
          ChangeNotifierProvider<app_auth.AuthProvider>.value(
            value: mockAuthProvider,
          ),
          ChangeNotifierProvider<InterviewProvider>.value(
            value: mockInterviewProvider,
          ),
          ChangeNotifierProvider<AppearanceProvider>.value(
            value: mockAppearanceProvider,
          ),
        ],
        child: MaterialApp(home: child),
      ),
    );
  }

  group('Interview Flow Tests', () {
    testWidgets(
      'recognition updates keep the sphere and screen layout stable',
      (tester) async {
        final listeners = <VoidCallback>[];
        when(() => mockInterviewProvider.addListener(any())).thenAnswer((call) {
          listeners.add(call.positionalArguments.single as VoidCallback);
        });
        when(() => mockInterviewProvider.removeListener(any())).thenAnswer((
          call,
        ) {
          listeners.remove(call.positionalArguments.single as VoidCallback);
        });
        final awake = ScreenAwakeService(platform: SmokeAwakePort());
        await tester.pumpWidget(
          createTestWidget(InterviewSessionScreen(screenAwakeService: awake)),
        );
        await tester.pumpAndSettle();
        final sphere = tester.widget<ParticleSphere>(
          find.byType(ParticleSphere),
        );
        final state = tester.state(find.byType(ParticleSphere));
        final position = tester.getTopLeft(find.byType(ParticleSphere));
        for (final count in [4, 40, 140]) {
          final text = List.filled(count, 'software project').join(' ');
          when(() => mockInterviewProvider.partialTranscript).thenReturn(text);
          for (final listener in List<VoidCallback>.of(listeners)) {
            listener();
          }
          await tester.pump();
          await tester.pump();
          expect(tester.widget(find.byType(ParticleSphere)), same(sphere));
          expect(tester.state(find.byType(ParticleSphere)), same(state));
          expect(tester.getTopLeft(find.byType(ParticleSphere)), position);
          expect(find.text(text), findsOneWidget);
          expect(tester.takeException(), isNull);
        }
        await tester.pumpWidget(const SizedBox());
        await tester.pump();
        await awake.settled;
        awake.dispose();
      },
    );

    testWidgets('Interview Session - Basic Initialization', (
      WidgetTester tester,
    ) async {
      final awake = ScreenAwakeService(platform: SmokeAwakePort());
      await tester.pumpWidget(
        createTestWidget(InterviewSessionScreen(screenAwakeService: awake)),
      );
      await tester.pumpAndSettle();

      expect(find.text('INTERVIEW MODE'), findsOneWidget);
      expect(find.byType(InterviewSessionScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      await awake.settled;
      awake.dispose();
    });
  });
}
