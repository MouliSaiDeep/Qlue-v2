import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/core/services/dashboard_api_service.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:frontend/core/models/session_model.dart';

class MockDashboardApiService extends Mock implements DashboardApiService {}

void main() {
  late MockDashboardApiService mockApi;

  setUp(() {
    mockApi = MockDashboardApiService();
  });

  group('DashboardProvider Tests', () {
    test('fetchDashboardData should update state with parallel results', () async {
      final provider = DashboardProvider(apiService: mockApi);

      final mockSummary = DashboardSummary(
        totalSessions: 10,
        completedSessions: 8,
        averageScore: 75,
        bestScore: 90,
        moduleBreakdown: {'RESUME': 5},
        bestScoreByModule: {'RESUME': 90},
      );

      final mockRadar = RadarData(
        data: {'OVERALL': {'Skill': 80}},
      );

      final List<SessionModel> mockHistory = [
        SessionModel(
          sessionId: 's1',
          userId: 'u1',
          moduleType: 'RESUME',
          status: 'TERMINATED',
          startedAt: DateTime.fromMillisecondsSinceEpoch(123456789),
        )
      ];

      when(() => mockApi.getSummary()).thenAnswer((_) async => mockSummary);
      when(() => mockApi.getModuleStats()).thenAnswer((_) async => mockRadar);
      when(() => mockApi.getHistory(limit: 5)).thenAnswer((_) async => mockHistory);

      await provider.fetchDashboardData();

      expect(provider.summary.totalSessions, 10);
      expect(provider.radarData.data['OVERALL']?['Skill'], 80);
      expect(provider.history.length, 1);
      expect(provider.isLoading, false);
      expect(provider.isStale, false);
    });

    test('markStale should update state', () {
      final provider = DashboardProvider(apiService: mockApi);
      provider.markStale();
      expect(provider.isStale, true);
    });
  });
}
