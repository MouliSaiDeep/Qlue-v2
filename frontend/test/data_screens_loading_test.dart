import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:network_image_mock/network_image_mock.dart';
import 'package:provider/provider.dart';
import 'package:frontend/components/data_loading.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/context/resume_provider.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:frontend/core/models/resume_model.dart';
import 'package:frontend/core/models/session_model.dart';
import 'package:frontend/core/services/dashboard_api_service.dart';
import 'package:frontend/core/services/resume_api_service.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/screens/tabs/dashboard_screen.dart';
import 'package:frontend/screens/tabs/history_screen.dart';
import 'package:frontend/screens/resume/resume_upload_screen.dart';

class MockDataApi extends Mock implements DashboardApiService {}

class MockResumeApi extends Mock implements ResumeApiService {}

class MockAuth extends Mock implements AuthProvider {}

class MockInterview extends Mock implements InterviewProvider {}

void main() {
  late MockAuth auth;
  late MockInterview interview;
  setUp(() {
    auth = MockAuth();
    interview = MockInterview();
    when(
      () => auth.profileImageUrl,
    ).thenReturn('https://example.invalid/avatar.png');
    when(() => auth.displayName).thenReturn('Synthetic candidate');
    when(() => interview.sessionId).thenReturn(null);
  });

  Widget wrap(
    Widget screen, {
    DashboardProvider? dashboard,
    ResumeProvider? resumes,
  }) => AppThemeColorsProvider(
    colors: AppThemeColors.dark,
    child: MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: auth),
        ChangeNotifierProvider<InterviewProvider>.value(value: interview),
        if (dashboard != null)
          ChangeNotifierProvider<DashboardProvider>.value(value: dashboard),
        if (resumes != null)
          ChangeNotifierProvider<ResumeProvider>.value(value: resumes),
      ],
      child: MaterialApp(home: screen),
    ),
  );

  testWidgets(
    'direct history entry resolves skeleton without dashboard fetch',
    (tester) async {
      await mockNetworkImagesFor(() async {
        final api = MockDataApi();
        final gate = Completer<List<SessionModel>>();
        when(() => api.getHistory()).thenAnswer((_) => gate.future);
        final provider = DashboardProvider(apiService: api);
        await tester.pumpWidget(
          wrap(const HistoryScreen(), dashboard: provider),
        );
        expect(find.byType(DataLoadingSkeleton), findsOneWidget);
        expect(find.text('No Interviews Yet'), findsNothing);
        gate.complete([]);
        await tester.pumpAndSettle();
        expect(find.byType(DataLoadingSkeleton), findsNothing);
        expect(find.text('No Interviews Yet'), findsOneWidget);
        expect(provider.hasLoadedOnce, isFalse);
        verifyNever(() => api.getSummary());
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        provider.dispose();
      });
    },
  );

  testWidgets(
    'first history error shows retry and preserves empty-state recovery',
    (tester) async {
      await mockNetworkImagesFor(() async {
        final api = MockDataApi();
        when(
          () => api.getHistory(),
        ).thenThrow(StateError('synthetic read failure'));
        final provider = DashboardProvider(apiService: api);
        await tester.pumpWidget(
          wrap(const HistoryScreen(), dashboard: provider),
        );
        await tester.pumpAndSettle();
        expect(find.byType(DataLoadError), findsOneWidget);
        expect(find.byType(DataLoadingSkeleton), findsNothing);
        when(() => api.getHistory()).thenAnswer((_) async => []);
        await tester.tap(find.text('Retry'));
        await tester.pumpAndSettle();
        expect(find.text('No Interviews Yet'), findsOneWidget);
        verify(() => api.getHistory()).called(2);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        provider.dispose();
      });
    },
  );

  testWidgets(
    'first dashboard error ends waiting and retry reveals loaded state',
    (tester) async {
      await mockNetworkImagesFor(() async {
        final api = MockDataApi();
        when(
          () => api.getSummary(),
        ).thenThrow(StateError('synthetic read failure'));
        when(
          () => api.getModuleStats(),
        ).thenAnswer((_) async => RadarData.initial());
        when(() => api.getHistory(limit: 5)).thenAnswer((_) async => []);
        final provider = DashboardProvider(apiService: api);
        await tester.pumpWidget(
          wrap(const DashboardScreen(), dashboard: provider),
        );
        await tester.pumpAndSettle();
        expect(find.byType(DataLoadError), findsOneWidget);
        when(
          () => api.getSummary(),
        ).thenAnswer((_) async => DashboardSummary.initial());
        await tester.tap(find.text('Retry'));
        await tester.pumpAndSettle();
        expect(provider.hasLoadedOnce, isTrue);
        expect(find.byType(DataLoadError), findsNothing);
        expect(find.byType(DataLoadingSkeleton), findsNothing);
        verify(() => api.getSummary()).called(2);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        provider.dispose();
      });
    },
  );

  testWidgets('resume list keeps loading distinct from failure and empty', (
    tester,
  ) async {
    final api = MockResumeApi();
    final gate = Completer<Map<String, dynamic>>();
    when(() => api.getResumeList()).thenAnswer((_) => gate.future);
    final provider = ResumeProvider(apiService: api);
    final read = provider.fetchResumes();
    await tester.pumpWidget(
      wrap(const ResumeUploadScreen(), resumes: provider),
    );
    expect(find.byType(DataLoadingSkeleton), findsOneWidget);
    gate.completeError(StateError('synthetic read failure'));
    await read;
    await tester.pumpAndSettle();
    expect(find.byType(DataLoadError), findsOneWidget);
    when(
      () => api.getResumeList(),
    ).thenAnswer((_) async => {'resumes': <ResumeModel>[], 'maxAllowed': 5});
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.textContaining('No resumes uploaded.'), findsOneWidget);
    expect(find.byType(DataLoadError), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    provider.dispose();
  });
}
