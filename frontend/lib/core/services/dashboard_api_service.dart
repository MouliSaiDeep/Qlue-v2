import "../constants/api_constants.dart";
import 'package:dio/dio.dart';
import '../network/dio_client.dart';
import '../models/session_model.dart';
import '../models/dashboard_model.dart';

class SessionHistoryPage {
  SessionHistoryPage({
    required this.sessions,
    this.nextCursor,
    Map<String, dynamic>? requestOwner,
  }) : _requestOwner = requestOwner;

  final List<SessionModel> sessions;
  final String? nextCursor;
  final Map<String, dynamic>? _requestOwner;
}

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
    SessionHistoryPage? page;
    do {
      page = await getHistoryPage(
        moduleType: moduleType,
        limit: wanted - history.length,
        after: page,
      );
      history.addAll(page.sessions.take(wanted - history.length));
      final cursor = page.nextCursor;
      if (history.length < wanted &&
          cursor != null &&
          !seenCursors.add(cursor)) {
        throw StateError('History pagination did not advance. Please retry.');
      }
      // Filtering can leave an empty page while older answered sessions remain.
    } while (page.nextCursor != null && history.length < wanted);
    return history;
  }

  Future<SessionHistoryPage> getHistoryPage({
    String? moduleType,
    int limit = 50,
    SessionHistoryPage? after,
  }) async {
    final owner = after?._requestOwner;
    final response = await _dio.get(
      ApiConstants.sessionHistory,
      queryParameters: {
        'limit': limit.clamp(1, 50),
        'moduleType': ?moduleType,
        'cursor': ?after?.nextCursor,
      },
      // Keep the first request's login ownership on every continuation.
      options: owner == null ? null : Options(extra: Map.of(owner)),
    );
    final List<dynamic> sessions = response.data['sessions'] ?? [];
    final cursor = response.data['nextCursor'];
    return SessionHistoryPage(
      sessions: [
        for (final session in sessions)
          if (session['discarded'] != true && session['answeredCount'] != 0)
            SessionModel.fromJson(session),
      ],
      nextCursor: cursor is String && cursor.isNotEmpty ? cursor : null,
      requestOwner: owner ?? Map.of(response.requestOptions.extra),
    );
  }
}
