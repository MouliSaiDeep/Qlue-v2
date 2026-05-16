import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
<<<<<<< HEAD
=======
import 'package:dio/dio.dart';
import 'package:frontend/core/network/dio_client.dart';
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
import 'package:frontend/context/dashboard_provider.dart';
import 'package:frontend/core/services/dashboard_api_service.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:frontend/core/models/session_model.dart';

class MockDashboardApiService extends Mock implements DashboardApiService {}

void main() {
  late MockDashboardApiService mockApi;

  setUp(() {
    mockApi = MockDashboardApiService();
<<<<<<< HEAD
=======
    // Mock the singleton Dio instance used by DashboardApiService
    DioClient().dio.interceptors.clear(); // Clear existing interceptors to avoid conflicts
    DioClient().dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (options.path.contains('summary')) {
          handler.resolve(Response(
            requestOptions: options,
            data: {
              'summary': {
                'totalSessions': 10,
                'completedSessions': 8,
                'averageScore': 75,
                'bestScore': 90,
                'moduleBreakdown': {'RESUME': 5},
                'bestScoreByModule': {'RESUME': 90},
                'latestFeedback': {
                  'strengths': ['S1'],
                  'improvements': ['I1'],
                  'tip': 'T1'
                }
              }
            },
            statusCode: 200,
          ));
        } else if (options.path.contains('stats')) {
          handler.resolve(Response(
            requestOptions: options,
            data: {
              'radarData': {
                'OVERALL': {'Skill': 80}
              }
            },
            statusCode: 200,
          ));
        } else if (options.path.contains('history')) {
          handler.resolve(Response(
            requestOptions: options,
            data: {
              'sessions': [
                {
                  'sessionId': 's1',
                  'userId': 'u1',
                  'moduleType': 'RESUME',
                  'status': 'TERMINATED',
                  'startedAt': 123456789,
                }
              ]
            },
            statusCode: 200,
          ));
        } else {
          handler.next(options);
        }
      },
    ));
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
  });

  group('DashboardProvider Tests', () {
    test('fetchDashboardData should update state with parallel results', () async {
<<<<<<< HEAD
      final provider = DashboardProvider(apiService: mockApi);
=======
      final provider = DashboardProvider();
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66

      final mockSummary = DashboardSummary(
        totalSessions: 10,
        completedSessions: 8,
        averageScore: 75,
        bestScore: 90,
        moduleBreakdown: {'RESUME': 5},
<<<<<<< HEAD
        bestModuleScores: {'RESUME': 90},
=======
        bestScoreByModule: {'RESUME': 90},
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
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
<<<<<<< HEAD
      expect(provider.isStale, false);
    });

    test('markStale should update state', () {
      final provider = DashboardProvider(apiService: mockApi);
      provider.markStale();
      expect(provider.isStale, true);
    });
=======
    });

>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
  });
}
