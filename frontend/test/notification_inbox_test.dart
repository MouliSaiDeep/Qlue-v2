import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:network_image_mock/network_image_mock.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/context/notification_inbox_provider.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:frontend/core/models/session_model.dart';
import 'package:frontend/core/services/dashboard_api_service.dart';
import 'package:frontend/core/theme.dart';
import 'package:frontend/core/update_service.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/screens/notifications_screen.dart';
import 'package:frontend/screens/tabs/dashboard_screen.dart';

class _Api extends Mock implements DashboardApiService {}

class _Auth extends Mock implements AuthProvider {}

class _Interview extends Mock implements InterviewProvider {}

class _Updates extends Mock implements UpdateService {}

SessionModel _session(
  String id,
  String status, {
  int day = 24,
  bool eligible = true,
}) => SessionModel.fromJson({
  'sessionId': id,
  'userId': 'account-a',
  'moduleType': 'HR',
  'startedAt': DateTime(2026, 11, day).millisecondsSinceEpoch,
  'feedbackStatus': status,
  'feedbackAttemptId': 'attempt-1',
  'feedbackExpected': eligible,
});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test(
    'pages feedback and retains read state only for the same account',
    () async {
      final api = _Api();
      final dashboard = DashboardProvider(apiService: api);
      final active = _session('active', 'PENDING');
      final first = SessionHistoryPage(
        sessions: [active, _session('skip', 'COMPLETE', eligible: false)],
        nextCursor: 'older',
      );
      when(() => api.getHistoryPage(limit: 25)).thenAnswer((_) async => first);
      when(() => api.getHistoryPage(limit: 25, after: first)).thenAnswer(
        (_) async =>
            SessionHistoryPage(sessions: [_session('old', 'FAILED', day: 20)]),
      );
      NotificationInboxProvider open(String userId) =>
          NotificationInboxProvider(
            userId: userId,
            dashboard: dashboard,
            apiService: api,
          );

      final inbox = open('account-a');
      await inbox.refresh();
      await pumpEventQueue();
      expect(
        inbox.items.single,
        isA<FeedbackNotification>().having(
          (item) => item.status,
          'status',
          SessionFeedbackStatus.generating,
        ),
      );
      inbox.markRead(inbox.items.single);
      await inbox.loadOlder();
      expect(inbox.canLoadOlder, isFalse);
      expect(inbox.items.map((item) => (item as FeedbackNotification).status), [
        SessionFeedbackStatus.generating,
        SessionFeedbackStatus.unavailable,
      ]);
      expect(inbox.isUnread(inbox.items.first), isFalse);
      expect(inbox.isUnread(inbox.items.last), isTrue);

      when(
        () => api.getSummary(),
      ).thenAnswer((_) async => DashboardSummary.initial());
      when(
        () => api.getModuleStats(),
      ).thenAnswer((_) async => RadarData.initial());
      when(
        () => api.getHistory(limit: 5),
      ).thenAnswer((_) async => [_session('active', 'COMPLETE')]);
      await dashboard.fetchDashboardData();
      expect(
        (inbox.items.first as FeedbackNotification).status,
        SessionFeedbackStatus.ready,
      );
      expect(inbox.isUnread(inbox.items.first), isTrue);
      inbox.markRead(inbox.items.first);
      await pumpEventQueue();
      inbox.dispose();

      final same = open('account-a');
      final otherDashboard = DashboardProvider(apiService: api);
      final other = NotificationInboxProvider(
        userId: 'account-b',
        dashboard: otherDashboard,
        apiService: api,
      );
      await pumpEventQueue();
      expect(same.isUnread(same.items.single), isFalse);
      expect(other.items, isEmpty);
      await other.refresh();
      expect(other.isUnread(other.items.single), isTrue);
      same.dispose();
      other.dispose();
      otherDashboard.dispose();
      dashboard.dispose();
    },
  );

  testWidgets(
    'dashboard bell opens the inbox and entries open their details',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 680));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await mockNetworkImagesFor(() async {
        final api = _Api();
        final auth = _Auth();
        final interview = _Interview();
        final service = _Updates();
        final feedback = _session('ready-session', 'COMPLETE');
        final update = UpdateInfo(
          version: '1.0.11',
          downloadUrl: 'https://example.invalid/Qlue.apk',
          releaseNotes: 'Clearer feedback.',
          sizeBytes: 0,
          publishedAt: DateTime(2026, 11, 25),
        );
        final available = ValueNotifier<UpdateInfo?>(update);
        when(() => service.availableUpdate).thenReturn(available);
        when(() => service.checkForUpdate()).thenAnswer((_) async => update);
        when(
          () => api.getSummary(),
        ).thenAnswer((_) async => DashboardSummary.initial());
        when(
          () => api.getModuleStats(),
        ).thenAnswer((_) async => RadarData.initial());
        when(
          () => api.getHistory(limit: 5),
        ).thenAnswer((_) async => [feedback]);
        when(
          () => api.getHistoryPage(limit: 25),
        ).thenAnswer((_) async => SessionHistoryPage(sessions: [feedback]));
        when(
          () => auth.profileImageUrl,
        ).thenReturn('https://example.invalid/avatar.png');
        when(() => auth.displayName).thenReturn('Synthetic candidate');
        when(() => interview.sessionId).thenReturn(null);
        final dashboard = DashboardProvider(apiService: api);
        final inbox = NotificationInboxProvider(
          userId: 'account-a',
          dashboard: dashboard,
          apiService: api,
          updateService: service,
        );
        final router = GoRouter(
          initialLocation: '/dashboard',
          routes: [
            GoRoute(
              path: '/dashboard',
              builder: (_, _) => const DashboardScreen(),
            ),
            GoRoute(
              path: '/notifications',
              builder: (_, _) => const NotificationsScreen(),
            ),
            GoRoute(
              path: '/feedback/:sessionId',
              builder: (_, state) => Scaffold(
                body: Text('Report ${state.pathParameters['sessionId']}'),
              ),
            ),
          ],
        );
        addTearDown(router.dispose);
        addTearDown(dashboard.dispose);
        addTearDown(available.dispose);
        addTearDown(inbox.dispose);

        await tester.pumpWidget(
          AppThemeColorsProvider(
            colors: AppThemeColors.dark,
            child: MultiProvider(
              providers: [
                ChangeNotifierProvider<AuthProvider>.value(value: auth),
                ChangeNotifierProvider<InterviewProvider>.value(
                  value: interview,
                ),
                ChangeNotifierProvider<DashboardProvider>.value(
                  value: dashboard,
                ),
                ChangeNotifierProvider<NotificationInboxProvider>.value(
                  value: inbox,
                ),
              ],
              child: MaterialApp.router(routerConfig: router),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Notifications, unread activity'));
        await tester.pumpAndSettle();
        expect(find.text('Notifications'), findsOneWidget);
        expect(find.text('App update available'), findsOneWidget);
        expect(find.text('Feedback ready'), findsOneWidget);

        await tester.tap(find.text('App update available'));
        await tester.pumpAndSettle();
        expect(find.text('Clearer feedback.'), findsOneWidget);
        await tester.tap(find.text('Later'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Feedback ready'));
        await tester.pumpAndSettle();
        expect(find.text('Report ready-session'), findsOneWidget);
        expect(inbox.hasUnread, isFalse);
      });
    },
    variant: const TargetPlatformVariant({TargetPlatform.iOS}),
  );
}
