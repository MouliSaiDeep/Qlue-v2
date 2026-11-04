import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/context/resume_provider.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:frontend/core/models/resume_model.dart';
import 'package:frontend/core/models/session_model.dart';
import 'package:frontend/core/services/dashboard_api_service.dart';
import 'package:frontend/core/services/resume_api_service.dart';
import 'package:frontend/screens/interview/particle_sphere.dart';
import 'package:frontend/screens/tabs/tabs_screen.dart';
import 'package:frontend/core/theme.dart';

class ResumeApi extends Mock implements ResumeApiService {}

class DashboardApi extends Mock implements DashboardApiService {}

ResumeModel row({bool active = false}) => ResumeModel(
  resumeId: 'r',
  fileName: 'synthetic.pdf',
  fileSize: 100,
  status: ResumeStatus.parsed,
  isActive: active,
);
Map<String, dynamic> rows({bool active = false}) => {
  'resumes': [row(active: active)],
  'maxAllowed': 5,
};
SessionModel session(
  String id,
  int score, {
  String module = 'HR',
  int day = 1,
}) => SessionModel(
  sessionId: id,
  userId: 'synthetic',
  moduleType: module,
  startedAt: DateTime(2026, 11, day),
  accumulatedScores: {'Overall': score},
);

void main() {
  test('late detail cannot undo a completed active-resume mutation', () async {
    final api = ResumeApi(), detail = Completer<ResumeModel>();
    var active = false;
    when(
      () => api.getResumeList(),
    ).thenAnswer((_) async => rows(active: active));
    when(() => api.getResumeDetail('r')).thenAnswer((_) => detail.future);
    when(() => api.setActiveResume('r')).thenAnswer((_) async {
      active = true;
    });
    final p = ResumeProvider(apiService: api);
    await p.fetchResumes();
    final pending = p.fetchResumeDetail('r');
    await p.setActiveResume('r');
    detail.complete(row());
    await pending;
    final actual = p.resumes.single.isActive;
    p.dispose();
    expect(actual, isTrue);
    verify(() => api.getResumeList()).called(2);
  });

  test('late detail cannot overwrite a newer list snapshot', () async {
    final api = ResumeApi(), detail = Completer<ResumeModel>();
    var active = false;
    when(
      () => api.getResumeList(),
    ).thenAnswer((_) async => rows(active: active));
    when(() => api.getResumeDetail('r')).thenAnswer((_) => detail.future);
    final p = ResumeProvider(apiService: api);
    await p.fetchResumes();
    final pending = p.fetchResumeDetail('r');
    active = true;
    await p.fetchResumes();
    detail.complete(row());
    await pending;
    final actual = p.resumes.single.isActive;
    p.dispose();
    expect(actual, isTrue);
  });

  test(
    'old detail completion cannot evict a fresh in-flight detail after mutation',
    () async {
      final api = ResumeApi();
      final old = Completer<ResumeModel>(), fresh = Completer<ResumeModel>();
      var details = 0;
      when(
        () => api.getResumeList(),
      ).thenAnswer((_) async => rows(active: true));
      when(() => api.setActiveResume('r')).thenAnswer((_) async {});
      when(
        () => api.getResumeDetail('r'),
      ).thenAnswer((_) => ++details == 1 ? old.future : fresh.future);
      final p = ResumeProvider(apiService: api);
      await p.fetchResumes();
      final first = p.fetchResumeDetail('r');
      await p.setActiveResume('r');
      final second = p.fetchResumeDetail('r');
      old.complete(row());
      await first;
      final joined = p.fetchResumeDetail('r');
      final shared = identical(second, joined);
      fresh.complete(row(active: true));
      await Future.wait([second, joined]);
      p.dispose();
      expect(shared, isTrue);
      expect(details, 2);
    },
  );

  test(
    'finishing an old read does not clear loading while a mutation is pending',
    () async {
      final api = ResumeApi();
      final readGate = Completer<Map<String, dynamic>>(),
          writeGate = Completer<void>();
      var reads = 0;
      when(() => api.getResumeList()).thenAnswer(
        (_) => ++reads == 1 ? readGate.future : Future.value(rows()),
      );
      when(() => api.deleteResume('r')).thenAnswer((_) => writeGate.future);
      final p = ResumeProvider(apiService: api);
      final read = p.fetchResumes();
      final write = p.deleteResume('r');
      readGate.complete(rows());
      await read;
      final stillLoading = p.isLoading;
      writeGate.complete();
      await write;
      p.dispose();
      expect(stillLoading, isTrue);
    },
  );

  test(
    'sign-out during upload validation never starts a new presign request',
    () async {
      final api = ResumeApi(), gate = Completer<Map<String, dynamic>>();
      when(() => api.validateResumeHash(any())).thenAnswer((_) => gate.future);
      when(
        () => api.generatePresignedUrl(
          fileName: any(named: 'fileName'),
          fileSize: any(named: 'fileSize'),
          fileHash: any(named: 'fileHash'),
        ),
      ).thenThrow(StateError('unexpected presign; no network'));
      final old = ResumeProvider(apiService: api);
      final pending = old.uploadResume(
        Uint8List.fromList([1, 2, 3]),
        'synthetic.pdf',
      );
      old.dispose();
      gate.complete({'isDuplicate': false});
      expect(await pending, isFalse);
      verifyNever(
        () => api.generatePresignedUrl(
          fileName: any(named: 'fileName'),
          fileSize: any(named: 'fileSize'),
          fileHash: any(named: 'fileHash'),
        ),
      );
    },
  );

  test('disposed mutation entry points do not make any requests', () async {
    final api = ResumeApi();
    final old = ResumeProvider(apiService: api)..dispose();
    await old.deleteResume('r');
    await old.setActiveResume('r');
    verifyNever(() => api.deleteResume(any()));
    verifyNever(() => api.setActiveResume(any()));
  });

  test(
    'existing dashboard refresh updates history scores without truncation or extra reads',
    () async {
      final api = DashboardApi();
      when(
        () => api.getHistory(),
      ).thenAnswer((_) async => [session('s', 10), session('older', 20)]);
      when(() => api.getHistory(limit: 5)).thenAnswer(
        (_) async => [session('new', 80, day: 3), session('s', 90, day: 2)],
      );
      when(
        () => api.getSummary(),
      ).thenAnswer((_) async => DashboardSummary.initial());
      when(
        () => api.getModuleStats(),
      ).thenAnswer((_) async => RadarData.initial());
      final p = DashboardProvider(apiService: api);
      await p.fetchHistory();
      await p.fetchDashboardData(silent: true);
      final ids = p.history.map((s) => s.sessionId).toList();
      final score = p.history.firstWhere((s) => s.sessionId == 's').score;
      p.dispose();
      expect(ids, ['new', 's', 'older']);
      expect(score, 90);
      verify(() => api.getHistory()).called(1);
      verify(() => api.getHistory(limit: 5)).called(1);
    },
  );

  test(
    'rejoining a slow filter clears a different filter error for listeners',
    () async {
      final api = DashboardApi(), slow = Completer<List<SessionModel>>();
      when(
        () => api.getHistory(moduleType: 'HR'),
      ).thenAnswer((_) => slow.future);
      when(
        () => api.getHistory(moduleType: 'INTRO'),
      ).thenThrow(StateError('synthetic failure'));
      final p = DashboardProvider(apiService: api);
      String? observedError;
      p.addListener(() => observedError = p.historyError);
      final pending = p.fetchHistory(moduleType: 'HR');
      await p.fetchHistory(moduleType: 'INTRO');
      final joined = p.fetchHistory(moduleType: 'HR');
      final cleared = observedError == null;
      slow.complete([]);
      await Future.wait([pending, joined]);
      p.dispose();
      expect(cleared, isTrue);
    },
  );

  testWidgets(
    'account replacement ignores old dashboard results and stops old timers',
    (tester) async {
      final api = DashboardApi(), slow = Completer<DashboardSummary>();
      when(() => api.getSummary()).thenAnswer((_) => slow.future);
      when(
        () => api.getModuleStats(),
      ).thenAnswer((_) async => RadarData.initial());
      when(
        () => api.getHistory(limit: 5),
      ).thenAnswer((_) async => [session('old-user', 60)]);
      final old = DashboardProvider(apiService: api)..startAutoRefresh();
      final pending = old.fetchDashboardData();
      old.dispose();
      final fresh = DashboardProvider(apiService: DashboardApi());
      slow.complete(DashboardSummary.initial());
      await pending;
      await tester.pump(const Duration(seconds: 90));
      expect(old.recentHistory, isEmpty);
      expect(fresh.history, isEmpty);
      verify(() => api.getSummary()).called(1);
      fresh.dispose();
    },
  );

  testWidgets(
    'repeated sphere mounting, drag, tick and disposal leave no ticker',
    (tester) async {
      for (var i = 0; i < 5; i++) {
        await tester.pumpWidget(
          const MaterialApp(
            home: SizedBox(
              width: 320,
              height: 320,
              child: ParticleSphere(moduleColor: Colors.green),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 16));
        await tester.drag(find.byType(ParticleSphere), const Offset(20, 10));
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(milliseconds: 32));
        expect(tester.binding.transientCallbackCount, 0);
        expect(tester.takeException(), isNull);
      }
    },
  );

  test(
    'recent updates respect the history module and existing 100-row bound',
    () async {
      final api = DashboardApi();
      when(
        () => api.getHistory(moduleType: 'HR'),
      ).thenAnswer((_) async => List.generate(100, (i) => session('s$i', 10)));
      when(() => api.getHistory(limit: 5)).thenAnswer(
        (_) async => [
          session('jd', 80, module: 'JD', day: 3),
          session('new-hr', 80, day: 3),
          session('s1', 90, day: 2),
        ],
      );
      when(
        () => api.getSummary(),
      ).thenAnswer((_) async => DashboardSummary.initial());
      when(
        () => api.getModuleStats(),
      ).thenAnswer((_) async => RadarData.initial());
      final p = DashboardProvider(apiService: api);
      await p.fetchHistory(moduleType: 'HR');
      await p.fetchDashboardData(silent: true);
      expect(p.history.length, 100);
      expect(p.history.every((s) => s.moduleType == 'HR'), isTrue);
      expect(p.history.first.sessionId, 'new-hr');
      expect(p.history.where((s) => s.sessionId == 's1').single.score, 90);
      p.dispose();
    },
  );

  test(
    'slow full history cannot roll back newer recent data; a subsequent full read is authoritative',
    () async {
      final api = DashboardApi(), gate = Completer<List<SessionModel>>();
      when(() => api.getHistory()).thenAnswer((_) => gate.future);
      when(
        () => api.getHistory(limit: 5),
      ).thenAnswer((_) async => [session('s', 90)]);
      when(
        () => api.getSummary(),
      ).thenAnswer((_) async => DashboardSummary.initial());
      when(
        () => api.getModuleStats(),
      ).thenAnswer((_) async => RadarData.initial());
      final p = DashboardProvider(apiService: api);
      final full = p.fetchHistory();
      await p.fetchDashboardData(silent: true);
      gate.complete([session('s', 10), session('older', 20)]);
      await full;
      expect(p.history.firstWhere((s) => s.sessionId == 's').score, 90);
      when(() => api.getHistory()).thenAnswer((_) async => []);
      await p.fetchHistory();
      expect(p.history, isEmpty);
      p.dispose();
    },
  );

  testWidgets(
    'tab navigation and shell removal stop refresh without ancestor lookup',
    (tester) async {
      final api = DashboardApi();
      when(
        () => api.getSummary(),
      ).thenAnswer((_) async => DashboardSummary.initial());
      when(
        () => api.getModuleStats(),
      ).thenAnswer((_) async => RadarData.initial());
      when(() => api.getHistory(limit: 5)).thenAnswer((_) async => []);
      final p = DashboardProvider(apiService: api);
      final router = GoRouter(
        initialLocation: '/dashboard',
        routes: [
          ShellRoute(
            builder: (_, _, child) => TabsScreen(child: child),
            routes: [
              for (final path in ['/dashboard', '/practice', '/history'])
                GoRoute(path: path, builder: (_, _) => const SizedBox()),
            ],
          ),
          GoRoute(path: '/login', builder: (_, _) => const Text('Signed out')),
        ],
      );
      await tester.pumpWidget(
        AppThemeColorsProvider(
          colors: AppThemeColors.dark,
          child: ChangeNotifierProvider<DashboardProvider>.value(
            value: p,
            child: MaterialApp.router(routerConfig: router),
          ),
        ),
      );
      await tester.pumpAndSettle();
      for (var i = 0; i < 3; i++) {
        router.go('/practice');
        await tester.pumpAndSettle();
        expect(p.isAutoRefreshing, isFalse);
        router.go('/history');
        await tester.pumpAndSettle();
        expect(p.isAutoRefreshing, isTrue);
      }
      router.go('/login');
      await tester.pumpAndSettle();
      final error = tester.takeException();
      final stopped = !p.isAutoRefreshing;
      await tester.pumpWidget(const SizedBox());
      router.dispose();
      p.dispose();
      expect(error, isNull);
      expect(stopped, isTrue);
      verify(() => api.getSummary()).called(1); // tab switches stay throttled
    },
  );
}
