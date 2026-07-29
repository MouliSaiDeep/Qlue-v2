import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/screens/interview/feedback_report_screen.dart';
import 'package:frontend/core/models/feedback_report_model.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/core/theme.dart';

// The feedback screen self-fetches its report via Dio; these tests use the
// screen's @visibleForTesting hooks (initialReport / initialError / autoFetch)
// to render each state deterministically without network or Firebase.

class MockAuthProvider extends Mock implements AuthProvider {}

void main() {
  late MockAuthProvider mockAuthProvider;

  setUp(() {
    mockAuthProvider = MockAuthProvider();
    when(() => mockAuthProvider.displayName).thenReturn('Alex Doe');
    when(() => mockAuthProvider.profession).thenReturn('Engineer');
  });

  Widget wrap(Widget child) {
    return AppThemeColorsProvider(
      colors: AppThemeColors.dark,
      child: ChangeNotifierProvider<AuthProvider>.value(
        value: mockAuthProvider,
        child: MaterialApp(home: child),
      ),
    );
  }

  testWidgets('renders loading state', (WidgetTester tester) async {
    await tester.pumpWidget(
      wrap(const FeedbackReportScreen(sessionId: 'test-session', autoFetch: false)),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Analyzing your transcription...'), findsOneWidget);
  });

  testWidgets('renders error state', (WidgetTester tester) async {
    await tester.pumpWidget(
      wrap(const FeedbackReportScreen(
        sessionId: 'test-session',
        initialError: 'Failed to load',
      )),
    );

    expect(find.text('Failed to load'), findsOneWidget);
    expect(find.text('Go Back'), findsOneWidget);
  });

  testWidgets('renders report data', (WidgetTester tester) async {
    final report = FeedbackReportModel(
      sessionId: 'test-session',
      overallScore: 88,
      dimensionScores: {'Clarity': 90, 'Fluency': 80, 'Vocabulary': 85},
      strengths: ['Great energy'],
      weaknesses: ['Umms and ahhs'],
      recommendations: [],
      executiveSummary: 'Very impressive performance.',
    );

    await tester.pumpWidget(
      wrap(FeedbackReportScreen(
        sessionId: 'test-session',
        initialReport: report,
      )),
    );
    await tester.pump();

    expect(find.text('88'), findsOneWidget); // Overall score
    expect(find.text('Performance Analysis'), findsOneWidget);
    expect(find.text('Very impressive performance.'), findsOneWidget);

    // Section tabs
    expect(find.text('Summary'), findsOneWidget);
    expect(find.text('Strengths'), findsOneWidget);
    expect(find.text('Weaknesses'), findsOneWidget);
  });
}
