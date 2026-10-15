import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:frontend/screens/interview/feedback_report_screen.dart';
import 'package:frontend/core/models/feedback_report_model.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/core/network/dio_client.dart';
import 'package:dio/dio.dart';
import 'dart:typed_data';

class NoFeedbackAdapter implements HttpClientAdapter {
  int requests = 0;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests++;
    return ResponseBody.fromString(
      '{"session":{"feedbackExpected":false},"feedback":null}',
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

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
      wrap(
        const FeedbackReportScreen(sessionId: 'test-session', autoFetch: false),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Analyzing your transcription...'), findsOneWidget);
  });

  testWidgets(
    'answerless termination stops feedback polling and shows retained-text explanation',
    (tester) async {
      final dio = DioClient().dio;
      final interceptors = dio.interceptors.toList();
      final previous = dio.httpClientAdapter;
      final adapter = NoFeedbackAdapter();
      dio.interceptors.clear();
      dio.httpClientAdapter = adapter;
      addTearDown(() {
        dio.httpClientAdapter = previous;
        dio.interceptors.addAll(interceptors);
      });
      await tester.pumpWidget(
        wrap(const FeedbackReportScreen(sessionId: 'no-accepted-answer')),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 9));
      expect(adapter.requests, 1);
      expect(find.textContaining('No answer was accepted'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('Go Back'), findsOneWidget);
    },
  );

  testWidgets('renders error state', (WidgetTester tester) async {
    await tester.pumpWidget(
      wrap(
        const FeedbackReportScreen(
          sessionId: 'test-session',
          initialError: 'Failed to load',
        ),
      ),
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
      wrap(
        FeedbackReportScreen(sessionId: 'test-session', initialReport: report),
      ),
    );
    await tester.pump();

    expect(find.text('88'), findsOneWidget); // Overall score
    expect(find.text('Performance Analysis'), findsOneWidget);
    expect(find.text('Very impressive performance.'), findsOneWidget);

    // Section tabs. The glass tab bar renders each label in two layers (a base
    // row plus a masked selected-overlay row), so a label can appear more than
    // once in the tree; assert presence rather than an exact count. "To Improve"
    // and "Strengths" open glass pop-up sheets; "Summary" is the resting section.
    expect(find.text('Summary'), findsWidgets);
    expect(find.text('Strengths'), findsWidgets);
    expect(find.text('To Improve'), findsWidgets);
  });
}
