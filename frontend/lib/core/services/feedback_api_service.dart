import 'package:dio/dio.dart';
import '../models/feedback_report_model.dart';
import '../network/dio_client.dart';
import '../constants/api_constants.dart';

class FeedbackApiService {
  final Dio _dio;

  FeedbackApiService({Dio? dio}) : _dio = dio ?? DioClient().dio;

  Future<FeedbackReportModel?> getFeedbackReport(String sessionId) async {
    try {
      final response = await _dio.get('${ApiConstants.feedbackReport}/$sessionId');
      if (response.statusCode == 200 && response.data != null) {
        return FeedbackReportModel.fromJson(response.data);
      }
      return null;
    } catch (e) {
      rethrow;
    }
  }
}
