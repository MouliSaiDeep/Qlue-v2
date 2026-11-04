import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/context/resume_provider.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:frontend/core/models/resume_model.dart';
import 'package:frontend/core/models/session_model.dart';
import 'package:frontend/core/services/dashboard_api_service.dart';
import 'package:frontend/core/services/resume_api_service.dart';
import 'package:frontend/screens/interview/particle_sphere.dart';

class MockResumeApi extends Mock implements ResumeApiService {}

class MockDashboardApi extends Mock implements DashboardApiService {}

ResumeModel resume(String id, ResumeStatus status) => ResumeModel(
  resumeId: id,
  fileName: 'synthetic.pdf',
  fileSize: 1024,
  status: status,
);

Map<String, dynamic> resumeList(ResumeStatus status) => {
  'resumes': [resume('r1', status)],
  'maxAllowed': 5,
};

SessionModel session(String id) => SessionModel(
  sessionId: id,
  userId: 'synthetic-user',
  moduleType: 'HR',
  status: 'TERMINATED',
  startedAt: DateTime(2026, 11, 3),
);

void main() {
  test(
    'concurrent resume readers await one request; later reads are fresh',
    () async {
      final api = MockResumeApi();
      final gate = Completer<Map<String, dynamic>>();
      when(() => api.getResumeList()).thenAnswer((_) => gate.future);
      final provider = ResumeProvider(apiService: api);
      final first = provider.fetchResumes();
      final second = provider.fetchResumes();
      expect(identical(first, second), isTrue);
      expect(provider.isLoading, isTrue);
      verify(() => api.getResumeList()).called(1);
      gate.complete(resumeList(ResumeStatus.parsed));
      await Future.wait([first, second]);
      expect(provider.resumes.single.resumeId, 'r1');
      expect(provider.isLoading, isFalse);
      await provider.fetchResumes();
      verify(() => api.getResumeList()).called(1);
      provider.dispose();
    },
  );

  testWidgets('slow resume parsing reads do not overlap polling ticks', (
    tester,
  ) async {
    final api = MockResumeApi();
    final gate = Completer<ResumeModel>();
    var parsed = false;
    when(() => api.getResumeList()).thenAnswer(
      (_) async =>
          resumeList(parsed ? ResumeStatus.parsed : ResumeStatus.parsing),
    );
    when(() => api.getResumeDetail('r1')).thenAnswer((_) => gate.future);
    final provider = ResumeProvider(apiService: api);
    await provider.fetchResumes();
    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(seconds: 2));
    verify(() => api.getResumeDetail('r1')).called(1);
    parsed = true;
    gate.complete(resume('r1', ResumeStatus.parsed));
    await tester.pump();
    await tester.pump(const Duration(seconds: 4));
    verifyNever(() => api.getResumeDetail('r1'));
    verify(() => api.getResumeList()).called(2);
    expect(provider.resumes.single.status, ResumeStatus.parsed);
    provider.dispose();
  });

  test(
    'different resume IDs are independent and errors allow a fresh retry',
    () async {
      final api = MockResumeApi();
      final firstGate = Completer<ResumeModel>();
      final secondGate = Completer<ResumeModel>();
      when(() => api.getResumeDetail('r1')).thenAnswer((_) => firstGate.future);
      when(
        () => api.getResumeDetail('r2'),
      ).thenAnswer((_) => secondGate.future);
      final provider = ResumeProvider(apiService: api);
      final first = provider.fetchResumeDetail('r1');
      final duplicate = provider.fetchResumeDetail('r1');
      final second = provider.fetchResumeDetail('r2');
      expect(identical(first, duplicate), isTrue);
      firstGate.completeError(StateError('synthetic failure'));
      secondGate.complete(resume('r2', ResumeStatus.parsed));
      expect(await first, isNull);
      expect((await second)?.resumeId, 'r2');
      when(
        () => api.getResumeDetail('r1'),
      ).thenAnswer((_) async => resume('r1', ResumeStatus.parsed));
      expect((await provider.fetchResumeDetail('r1'))?.resumeId, 'r1');
      verify(() => api.getResumeDetail('r1')).called(2);
      provider.dispose();
    },
  );

  test('resume mutation waits for old list then fetches fresh state', () async {
    final api = MockResumeApi();
    final gate = Completer<Map<String, dynamic>>();
    var lists = 0;
    when(() => api.getResumeList()).thenAnswer(
      (_) => ++lists == 1
          ? gate.future
          : Future.value({'resumes': <ResumeModel>[], 'maxAllowed': 5}),
    );
    when(() => api.deleteResume('r1')).thenAnswer((_) async {});
    final provider = ResumeProvider(apiService: api);
    final read = provider.fetchResumes();
    final mutation = provider.deleteResume('r1');
    gate.complete(resumeList(ResumeStatus.parsed));
    await Future.wait([read, mutation]);
    expect(lists, 2);
    expect(provider.resumes, isEmpty);
    provider.dispose();
  });

  testWidgets('disposed resume provider ignores late reads and stops polling', (
    tester,
  ) async {
    final api = MockResumeApi();
    final gate = Completer<Map<String, dynamic>>();
    when(() => api.getResumeList()).thenAnswer((_) => gate.future);
    final provider = ResumeProvider(apiService: api);
    final read = provider.fetchResumes();
    provider.dispose();
    gate.complete(resumeList(ResumeStatus.parsing));
    await read;
    await tester.pump(const Duration(seconds: 8));
    expect(provider.resumes, isEmpty);
    verifyNever(() => api.getResumeDetail(any()));
    await provider.fetchResumes();
    verify(() => api.getResumeList()).called(1);
  });

  test(
    'dashboard refresh cannot truncate full history and shared callers wait',
    () async {
      final api = MockDashboardApi();
      final full = List.generate(50, (i) => session('s$i'));
      final recent = full.take(5).toList();
      final historyGate = Completer<List<SessionModel>>();
      final summaryGate = Completer<DashboardSummary>();
      when(() => api.getHistory()).thenAnswer((_) => historyGate.future);
      when(() => api.getHistory(limit: 5)).thenAnswer((_) async => recent);
      when(() => api.getSummary()).thenAnswer((_) => summaryGate.future);
      when(
        () => api.getModuleStats(),
      ).thenAnswer((_) async => RadarData.initial());
      final provider = DashboardProvider(apiService: api);
      final history = provider.fetchHistory();
      final duplicate = provider.fetchHistory();
      expect(identical(history, duplicate), isTrue);
      historyGate.complete(full);
      await history;
      expect(provider.hasLoadedHistory, isTrue);
      expect(provider.hasLoadedOnce, isFalse);
      final dashboard = provider.fetchDashboardData(silent: true);
      final shared = provider.fetchDashboardData();
      expect(identical(dashboard, shared), isTrue);
      var complete = false;
      shared.then((_) => complete = true);
      await Future<void>.delayed(Duration.zero);
      expect(complete, isFalse);
      summaryGate.complete(DashboardSummary.initial());
      await Future.wait([dashboard, shared]);
      expect(provider.history.length, 50);
      expect(provider.recentHistory.length, 5);
      verify(() => api.getSummary()).called(1);
      verify(() => api.getHistory()).called(1);
      provider.dispose();
    },
  );

  test(
    'history filter changes ignore obsolete responses and may rejoin a read',
    () async {
      final api = MockDashboardApi();
      final hr = Completer<List<SessionModel>>();
      final intro = Completer<List<SessionModel>>();
      when(() => api.getHistory(moduleType: 'HR')).thenAnswer((_) => hr.future);
      when(
        () => api.getHistory(moduleType: 'INTRO'),
      ).thenAnswer((_) => intro.future);
      final provider = DashboardProvider(apiService: api);
      final first = provider.fetchHistory(moduleType: 'HR');
      final second = provider.fetchHistory(moduleType: 'INTRO');
      final rejoined = provider.fetchHistory(moduleType: 'HR');
      expect(identical(first, rejoined), isTrue);
      intro.complete([session('intro')]);
      await second;
      expect(provider.hasLoadedHistory, isFalse);
      hr.complete([session('hr')]);
      await first;
      expect(provider.history.single.sessionId, 'hr');
      expect(provider.isHistoryLoading, isFalse);
      provider.dispose();
    },
  );

  test('first-load failures expose recovery and allow history retry', () async {
    final api = MockDashboardApi();
    when(() => api.getHistory()).thenThrow(StateError('synthetic failure'));
    final provider = DashboardProvider(apiService: api);
    await provider.fetchHistory();
    expect(provider.historyError, isNotNull);
    expect(provider.hasLoadedHistory, isFalse);
    expect(provider.isHistoryLoading, isFalse);
    when(() => api.getHistory()).thenAnswer((_) async => []);
    await provider.fetchHistory();
    expect(provider.historyError, isNull);
    expect(provider.hasLoadedHistory, isTrue);
    expect(provider.history, isEmpty);
    provider.dispose();
  });

  testWidgets('sphere animation repaints without rebuilding gesture widgets', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SizedBox(
          width: 320,
          height: 320,
          child: ParticleSphere(moduleColor: Colors.green),
        ),
      ),
    );
    final gestures = find.descendant(
      of: find.byType(ParticleSphere),
      matching: find.byType(GestureDetector),
    );
    final before = tester.widget<GestureDetector>(gestures);
    await tester.pump(const Duration(milliseconds: 16));
    await tester.pump(const Duration(milliseconds: 16));
    final after = tester.widget<GestureDetector>(gestures);
    await tester.pumpWidget(const SizedBox());
    expect(identical(before, after), isTrue);
  });

  testWidgets('sphere respects reduce motion changes after mounting', (
    tester,
  ) async {
    Widget sphere(bool animate) => MaterialApp(
      home: SizedBox(
        width: 320,
        height: 320,
        child: ParticleSphere(moduleColor: Colors.green, animate: animate),
      ),
    );
    await tester.pumpWidget(sphere(true));
    await tester.pump(const Duration(milliseconds: 16));
    await tester.pumpWidget(sphere(false));
    await tester.pump(const Duration(milliseconds: 16));
    final stillAnimating = tester.binding.hasScheduledFrame;
    await tester.pumpWidget(sphere(true));
    await tester.pump(const Duration(milliseconds: 16));
    expect(tester.binding.hasScheduledFrame, isTrue);
    await tester.pumpWidget(const SizedBox());
    expect(stillAnimating, isFalse);
  });
}
