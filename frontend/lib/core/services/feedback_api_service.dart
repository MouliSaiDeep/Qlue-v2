import '../network/dio_client.dart';
import '../constants/api_constants.dart';
import '../models/feedback_report_model.dart';

class FeedbackApiService {
  final _dio = DioClient().dio;

  Future<FeedbackReportModel?> getFeedbackReport(String sessionId) async {
    final response = await _dio.get('${ApiConstants.feedbackReport}/$sessionId');
    if (response.statusCode == 200) {
      final data = response.data['feedback'];
      if (data == null) return null;
      return FeedbackReportModel.fromJson(data);
    }
    return null;
  }
}
