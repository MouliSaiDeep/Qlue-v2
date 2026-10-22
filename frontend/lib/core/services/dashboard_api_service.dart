import "../constants/api_constants.dart";
import 'package:dio/dio.dart';
import '../network/dio_client.dart';
import '../models/session_model.dart';
import '../models/dashboard_model.dart';

class DashboardApiService {
  final _dio = DioClient().dio;

  Future<DashboardSummary> getSummary() async {
    final response = await _dio.get('/dashboard/summary');
    return DashboardSummary.fromJson(response.data);
  }

  Future<RadarData> getModuleStats({String period = '30d'}) async {
    final response = await _dio.get(
      '/dashboard/stats',
      queryParameters: {'period': period},
    );
    return RadarData.fromJson(response.data);
  }

  Future<List<SessionModel>> getHistory({
    String? moduleType,
    int limit = 100,
  }) async {
    final wanted = limit.clamp(1, 100);
    final history = <SessionModel>[];
    final seenCursors = <String>{};
    String? cursor;
    Map<String, dynamic>? owner;
    do {
      final response = await _dio.get(
        ApiConstants.sessionHistory,
        queryParameters: {
          'limit': (wanted - history.length).clamp(1, 50),
          'moduleType': ?moduleType,
          'cursor': ?cursor,
        },
        // Continuation requests keep the first request's login ownership.
        // A sign-out/account switch cancels paging instead of mixing accounts.
        options: owner == null ? null : Options(extra: Map.of(owner)),
      );
      owner ??= Map<String, dynamic>.from(response.requestOptions.extra);
      final List sessions = response.data['sessions'] ?? [];
      for (final session in sessions) {
        // Also protects clients talking to an older backend that returns these
        // rows. Do not hide legitimate answers merely because their score is 0.
        if (session['discarded'] == true || session['answeredCount'] == 0) {
          continue;
        }
        history.add(SessionModel.fromJson(session));
        if (history.length >= wanted) break;
      }
      final next = response.data['nextCursor'];
      cursor = next is String && next.isNotEmpty ? next : null;
      if (history.length < wanted &&
          cursor != null &&
          !seenCursors.add(cursor)) {
        throw StateError('History pagination did not advance. Please retry.');
      }
      // Filtering can leave an empty page while older answered sessions remain.
    } while (cursor != null && history.length < wanted);
    return history;
  }
}
