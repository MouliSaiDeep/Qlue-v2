import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/screens/interview/interview_recovery_controls.dart';
import 'package:frontend/screens/profile/widgets/profile_settings.dart';
import 'package:frontend/core/theme.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'interview_capture_recovery_test.dart' as capture;
import 'account_isolation_test.dart' as fixture;

void main() {
  testWidgets(
    'daily voice limit stops automatic retries and preserves the draft',
    (tester) async {
      final mic = capture.Capture();
      final provider = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      provider.debugStartListening();
      await tester.pump();
      mic.onPartialCb!('My draft answer');
      mic.error!(SpeechRecognitionError('STREAM_DAILY_LIMIT', true));
      await tester.pump(const Duration(seconds: 10));
      expect(provider.currentPhase, InterviewPhase.error);
      expect(provider.partialTranscript, 'My draft answer');
      expect(provider.errorMessage, contains('daily voice limit'));
      expect(mic.starts, 1);
      expect(provider.isPreparingVoice, false);
      provider.dispose();
    },
  );

  testWidgets(
    'busy service uses bounded recovery and explains that recording is not ready',
    (tester) async {
      final mic = capture.Capture();
      final provider = InterviewProvider(
        sttService: mic,
        ttsService: fixture.FakeTts(),
      );
      provider.debugStartListening();
      await tester.pump();
      mic.status!('starting');
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: InterviewRecoveryControls(provider: provider)),
        ),
      );
      expect(find.textContaining('Your microphone stays off'), findsOneWidget);
      mic.error!(SpeechRecognitionError('STREAM_CAPACITY', true));
      expect(provider.errorMessage, contains('voice service is busy'));
      expect(provider.recoveryAttempt, 1);
      provider.dispose();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 3));
    },
  );

  testWidgets('profile settings wrap long labels at large text sizes', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.darkTheme,
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(320, 800),
            textScaler: TextScaler.linear(2),
          ),
          child: const AppThemeColorsProvider(
            colors: AppThemeColors.dark,
            child: Scaffold(
              body: SizedBox(
                width: 300,
                child: SettingRow(
                  icon: Icons.settings,
                  label: 'Appearance preferences',
                  iconColor: Colors.white,
                  iconBg: Colors.black,
                  right: Text('System appearance'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Appearance preferences'), findsOneWidget);
  });
}
