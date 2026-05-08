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
    final response = await _dio.get('/dashboard/stats', queryParameters: {'period': period});
    return RadarData.fromJson(response.data);
  }

  Future<List<SessionModel>> getHistory({String? moduleType, int limit = 20}) async {
    final response = await _dio.get('/dashboard/history', queryParameters: {
      if (moduleType != null) 'moduleType': moduleType,
      'limit': limit,
    });
    
    final List sessions = response.data['sessions'] ?? [];
    return sessions.map((s) => SessionModel.fromJson(s)).toList();
  }
}
