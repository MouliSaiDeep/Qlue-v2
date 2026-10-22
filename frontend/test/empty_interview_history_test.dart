import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/network/dio_client.dart';
import 'package:frontend/core/services/dashboard_api_service.dart';

void main() {
  final dio = DioClient().dio;
  late List<Interceptor> original;
  setUp(() {
    original = List.of(dio.interceptors);
    dio.interceptors.clear();
  });
  tearDown(() {
    dio.interceptors.clear();
    dio.interceptors.addAll(original);
  });

  test(
    'older backend empty entries are hidden while answered zero scores and legacy entries remain',
    () async {
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            handler.resolve(
              Response(
                requestOptions: options,
                data: {
                  'sessions': [
                    {
                      'sessionId': 'empty',
                      'discarded': true,
                      'feedbackExpected': false,
                      'answeredCount': 0,
                    },
                    {'sessionId': 'first-question-only', 'answeredCount': 0},
                    {
                      'sessionId': 'answered',
                      'answeredCount': 1,
                      'accumulatedScores': {'Overall': 0},
                    },
                    {'sessionId': 'legacy'},
                  ],
                },
              ),
            );
          },
        ),
      );
      final sessions = await DashboardApiService().getHistory();
      expect(sessions.map((s) => s.sessionId), ['answered', 'legacy']);
      expect(sessions.first.score, 0);
    },
  );

  test(
    'an empty filtered page does not hide older answered interviews',
    () async {
      final requests = <RequestOptions>[];
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests.add(options);
            final first = options.queryParameters['cursor'] == null;
            handler.resolve(
              Response(
                requestOptions: options,
                data: {
                  'sessions': first
                      ? [
                          {
                            'sessionId': 'empty',
                            'discarded': true,
                            'feedbackExpected': false,
                          },
                        ]
                      : [
                          {'sessionId': 'older', 'answeredCount': 1},
                          {'sessionId': 'another', 'answeredCount': 1},
                        ],
                  'nextCursor': first ? 'older-page' : null,
                },
              ),
            );
          },
        ),
      );
      final sessions = await DashboardApiService().getHistory(
        moduleType: 'INTRO',
        limit: 1,
      );
      expect(sessions.map((s) => s.sessionId), ['older']);
      expect(requests, hasLength(2));
      expect(requests.last.queryParameters, {
        'limit': 1,
        'moduleType': 'INTRO',
        'cursor': 'older-page',
      });
    },
  );

  test(
    'history stops an unchanged continuation cursor instead of looping indefinitely',
    () async {
      var calls = 0;
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            calls++;
            handler.resolve(
              Response(
                requestOptions: options,
                data: {'sessions': [], 'nextCursor': 'same'},
              ),
            );
          },
        ),
      );
      await expectLater(DashboardApiService().getHistory(), throwsStateError);
      expect(calls, 2);
    },
  );
}
