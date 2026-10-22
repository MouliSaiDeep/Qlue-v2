import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/core/models/feedback_report_model.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/screens/interview/feedback_report_screen.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
import 'package:frontend/screens/interview/widgets/feedback_radar_chart.dart';
import 'feedback_screen_test.dart' show MockAuthProvider;

void main() {
  final report = FeedbackReportModel.fromJson({
    'sessionId': 'synthetic',
    'overallScore': 67.5,
    'dimensionScores': {
      'Relevance': 75,
      'Specific Evidence': 50,
      'Structure': 75,
      'Clarity': 75,
    },
    'strengths': ['You describe building an interview platform for students.'],
    'weaknesses': [
      'Your project example does not explain which feature you implemented.',
    ],
    'recommendations': [
      'Describe one feature you built and the result of testing it.',
    ],
    'executiveSummary':
        'You connect your engineering background with a mobile internship and an interview practice project. Explain your own implementation work to make the example more specific.',
    'transcript': [
      {'speaker': 'AI', 'text': 'Which feature did you build?', 'turnIndex': 0},
      {
        'speaker': 'USER',
        'text': 'I built an interview platform.',
        'turnIndex': 1,
      },
    ],
    'assessment': {
      'scope': 'FINAL_INTRODUCTION',
      'answers': [{}, {}],
    },
    'scoreExplanations': [
      for (final label in [
        'Relevance',
        'Specific Evidence',
        'Structure',
        'Clarity',
      ])
        {
          'label': label,
          'weight': label == 'Clarity'
              ? 15
              : label == 'Structure'
              ? 25
              : 30,
          'reason':
              'Your internship and project address the question; your personal implementation detail needs explanation.',
          'evidence': [
            {'answerId': 'final', 'quote': 'I built an interview platform.'},
          ],
        },
    ],
  });
  for (final layout in [(360.0, 800.0, 1.0), (320.0, 640.0, 2.0)]) {
    testWidgets(
      'all score explanations fit at $layout without fabricated claims',
      (tester) async {
        tester.view.physicalSize = Size(layout.$1, layout.$2);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final auth = MockAuthProvider();
        when(() => auth.displayName).thenReturn('Synthetic Candidate');
        when(() => auth.profession).thenReturn('Engineering student');
        await tester.pumpWidget(
          ChangeNotifierProvider<AuthProvider>.value(
            value: auth,
            child: MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(layout.$3)),
                child: AppThemeColorsProvider(
                  colors: AppThemeColors.dark,
                  child: child!,
                ),
              ),
              home: FeedbackReportScreen(
                sessionId: 'synthetic',
                initialReport: report,
              ),
            ),
          ),
        );
        await tester.pump();
        await tester.ensureVisible(
          find.byKey(const ValueKey('criterion-Specific Evidence')),
        );
        await tester.tap(
          find.byKey(const ValueKey('criterion-Specific Evidence')),
        );
        await tester.pumpAndSettle();
        expect(find.text('From your answer'), findsOneWidget);
        expect(
          find.descendant(
            of: find.byKey(const Key('criterion-detail-sheet')),
            matching: find.textContaining('I built an interview platform.'),
          ),
          findsOneWidget,
        );
        expect(find.byType(ExpansionTile), findsNothing);
        await tester.tap(find.byTooltip('Next criterion'));
        await tester.pumpAndSettle();
        expect(find.text('3 of 4 · Swipe to compare'), findsOneWidget);
        expect(find.text('25% of the overall score'), findsOneWidget);
        await tester.tap(find.byTooltip('Next criterion'));
        await tester.pumpAndSettle();
        expect(find.text('15% of the overall score'), findsOneWidget);
        expect(
          tester
              .widget<IconButton>(
                find.byWidgetPredicate(
                  (w) => w is IconButton && w.tooltip == 'Next criterion',
                ),
              )
              .onPressed,
          isNull,
        );
        await tester.fling(
          find.byKey(const Key('criterion-detail-sheet')),
          const Offset(260, 0),
          700,
        );
        await tester.pumpAndSettle();
        expect(find.text('3 of 4 · Swipe to compare'), findsOneWidget);
        await tester.tap(find.byTooltip('Close details'));
        await tester.pumpAndSettle();
        expect(report.assessedAnswers, 1);
        expect(report.scoreExplanations.length, 4);
        expect(find.text('75/100'), findsNWidgets(3));
        expect(find.text('50/100'), findsOneWidget);
        expect(find.text('Clarity'), findsOneWidget);
        expect(find.textContaining('Top 15%'), findsNothing);
        expect(find.textContaining('Great effort'), findsNothing);
        expect(tester.takeException(), isNull);
        final scroll = find.byType(SingleChildScrollView).first;
        await tester.drag(scroll, const Offset(0, -2500));
        await tester.pumpAndSettle();
        expect(find.text('Q&A Transcript'), findsOneWidget);
        expect(find.text('AI: Which feature did you build?'), findsOneWidget);
        expect(
          find.text('You: I built an interview platform.'),
          findsOneWidget,
        );
        expect(find.text('Review Q&A transcript'), findsNothing);
        expect(find.text('Read full summary'), findsNothing);
        final tabs = find.byType(lg.GlassTabBar);
        if (layout.$3 <= 1.3) {
          expect(tabs, findsOneWidget);
          await tester.ensureVisible(tabs);
          await tester.tapAt(tester.getRect(tabs).center);
        } else {
          await tester.ensureVisible(find.text('Strengths'));
          await tester.tap(find.text('Strengths'));
        }
        await tester.pumpAndSettle();
        expect(find.text('Your Strengths'), findsOneWidget);
        expect(
          find.text(
            'You describe building an interview platform for students.',
          ),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
  testWidgets('empty legacy data does not invent criterion marks or praise', (
    tester,
  ) async {
    final auth = MockAuthProvider();
    when(() => auth.displayName).thenReturn('Candidate');
    when(() => auth.profession).thenReturn('');
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: auth,
        child: MaterialApp(
          builder: (context, child) => AppThemeColorsProvider(
            colors: AppThemeColors.dark,
            child: child!,
          ),
          home: FeedbackReportScreen(
            initialReport: FeedbackReportModel(
              sessionId: 's',
              overallScore: 0,
              dimensionScores: {},
              strengths: [],
              weaknesses: [],
              recommendations: [],
              executiveSummary: 'No explanation was saved.',
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Metric 2'), findsNothing);
    expect(find.text('80/100'), findsNothing);
    expect(
      find.text('No criterion scores were saved for this report.'),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('reduced motion disables the radar entry animation', (
    tester,
  ) async {
    final auth = MockAuthProvider();
    when(() => auth.displayName).thenReturn('Candidate');
    await tester.pumpWidget(
      ChangeNotifierProvider<AuthProvider>.value(
        value: auth,
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: AppThemeColorsProvider(
              colors: AppThemeColors.dark,
              child: child!,
            ),
          ),
          home: FeedbackReportScreen(initialReport: report),
        ),
      ),
    );
    expect(
      tester
          .widget<FeedbackRadarChart>(find.byType(FeedbackRadarChart))
          .reduceMotion,
      true,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
