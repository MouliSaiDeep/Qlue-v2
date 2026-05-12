import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:mockito/mockito.dart';
import 'package:mockito/annotations.dart';
import 'package:frontend/screens/interview/feedback_report_screen.dart';
import 'package:frontend/context/feedback_provider.dart';
import 'package:frontend/core/models/feedback_report_model.dart';
import 'package:frontend/core/models/session_model.dart';
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/context/auth_provider.dart';

@GenerateMocks([FeedbackProvider, DashboardProvider, AuthProvider])
import 'feedback_screen_test.mocks.dart';

void main() {
  late MockFeedbackProvider mockFeedbackProvider;
  late MockDashboardProvider mockDashboardProvider;

  setUp(() {
    mockFeedbackProvider = MockFeedbackProvider();
    mockDashboardProvider = MockDashboardProvider();

    // Default mock behavior
    when(mockFeedbackProvider.isLoading).thenReturn(false);
    when(mockFeedbackProvider.error).thenReturn(null);
    when(mockFeedbackProvider.report).thenReturn(null);
  });

  Widget createWidgetUnderTest() {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<FeedbackProvider>.value(value: mockFeedbackProvider),
        ChangeNotifierProvider<DashboardProvider>.value(value: mockDashboardProvider),
      ],
      child: const MaterialApp(
        home: FeedbackReportScreen(sessionId: 'test-session'),
      ),
    );
  }

  testWidgets('renders loading state', (WidgetTester tester) async {
    when(mockFeedbackProvider.isLoading).thenReturn(true);
    
    await tester.pumpWidget(createWidgetUnderTest());
    
    expect(find.text('Synthesizing actionable feedback...'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('renders error state', (WidgetTester tester) async {
    when(mockFeedbackProvider.error).thenReturn('Failed to load');
    
    await tester.pumpWidget(createWidgetUnderTest());
    
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

    when(mockFeedbackProvider.report).thenReturn(report);
    
    await tester.pumpWidget(createWidgetUnderTest());
    
    expect(find.text('88'), findsOneWidget); // Score
    expect(find.text('Performance Analysis'), findsOneWidget);
    expect(find.text('Very impressive performance.'), findsOneWidget);
    
    // Check tabs
    expect(find.text('Summary'), findsOneWidget);
    expect(find.text('Strengths'), findsOneWidget);
    expect(find.text('Weaknesses'), findsOneWidget);
  });
}
