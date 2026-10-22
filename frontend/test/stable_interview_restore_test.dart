import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/context/appearance_provider.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/screens/interview/interview_session_screen.dart';
import 'package:frontend/screens/interview/particle_sphere.dart';
import 'package:frontend/shared/services/screen_awake_service.dart';
import 'account_isolation_test.dart' as ports;
import 'interview_screen_awake_test.dart' as awake;

class StableInterviewAuth extends Mock implements AuthProvider {}

class StableAppearance extends Mock implements AppearanceProvider {}

class StableInterview extends InterviewProvider {
  StableInterview()
    : super(sttService: ports.FakeStt(), ttsService: ports.FakeTts());
  @override
  InterviewPhase get currentPhase =>
      isConnecting ? InterviewPhase.ready : InterviewPhase.listening;
  @override
  void resetForNewSession() {}
  @override
  Future<void> initSession(
    String type, {
    String? resumeId,
    String? websiteUrl,
    String? analysisId,
  }) async {}
}

void main() {
  for (final layout in [
    (412.0, 915.0, 1.0),
    (360.0, 800.0, 1.0),
    (320.0, 640.0, 2.0),
  ]) {
    testWidgets(
      'stable interview at $layout keeps transcript updates isolated',
      (tester) async {
        tester.view.physicalSize = Size(layout.$1, layout.$2);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final auth = StableInterviewAuth();
        when(() => auth.voiceId).thenReturn('Tiffany');
        when(() => auth.voiceMode).thenReturn('cost_saver');
        final appearance = StableAppearance();
        when(() => appearance.reduceMotion).thenReturn(true);
        final p = StableInterview()
          ..moduleType = 'INTRO'
          ..sessionId = 'synthetic-layout'
          ..isListening = true;
        p.finalQuestionText = 'Tell me about yourself.';
        await tester.pumpWidget(
          MultiProvider(
            providers: [
              ChangeNotifierProvider<AuthProvider>.value(value: auth),
              ChangeNotifierProvider<AppearanceProvider>.value(
                value: appearance,
              ),
              ChangeNotifierProvider<InterviewProvider>.value(value: p),
            ],
            child: MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(layout.$3),
                  padding: const EdgeInsets.only(top: 24, bottom: 24),
                ),
                child: child!,
              ),
              home: InterviewSessionScreen(
                moduleType: 'INTRO',
                screenAwakeService: ScreenAwakeService(
                  platform: awake.AwakePort(),
                ),
              ),
            ),
          ),
        );
        await tester.pump(const Duration(seconds: 1));
        final sphere = find.byKey(const Key('interview-sphere-slot'));
        final rect = tester.getRect(sphere);
        p.isConnecting = true;
        p.notifyListeners();
        await tester.pump();
        expect(
          tester.getCenter(sphere),
          Offset(layout.$1 / 2, layout.$2 / 2),
          reason:
              'The starting bubble should be centered in the interview body',
        );
        expect(find.text('Preparing your interview…'), findsOneWidget);
        p.isConnecting = false;
        p.notifyListeners();
        await tester.pump();
        expect(tester.getRect(sphere), rect);
        final state = tester.state(find.byType(ParticleSphere));
        if (layout.$3 == 1) {
          expect(rect.height, 320);
          expect(rect.center.dy, greaterThan(layout.$2 * .3));
        }
        p.partialTranscript = List.filled(
          100,
          'I built and tested a study planner.',
        ).join(' ');
        p.notifyListeners();
        await tester.pump();
        expect(tester.getRect(sphere), rect);
        expect(tester.state(find.byType(ParticleSphere)), same(state));
        expect(find.text('END'), findsOneWidget);
        expect(find.textContaining('Pauses under 4 seconds'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        p.dispose();
        await tester.pump();
      },
    );
  }
}
