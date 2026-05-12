import 'package:flutter/material.dart';
import '../core/models/feedback_report_model.dart';
import '../core/services/feedback_api_service.dart';

class FeedbackProvider extends ChangeNotifier {
  final FeedbackApiService _apiService;

  FeedbackProvider({FeedbackApiService? apiService})
      : _apiService = apiService ?? FeedbackApiService();

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  FeedbackReportModel? _report;
  FeedbackReportModel? get report => _report;

  String? _error;
  String? get error => _error;

  void clear() {
    _report = null;
    _error = null;
    notifyListeners();
  }

  Future<void> fetchReport(String sessionId, {int retries = 3}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await _apiService.getFeedbackReport(sessionId);
      if (result == null) {
        if (retries > 0) {
          await Future.delayed(const Duration(seconds: 2));
          return fetchReport(sessionId, retries: retries - 1);
        } else {
          _error = "Unable to load feedback. It might still be processing.";
        }
      } else {
        _report = result;
      }
    } catch (e) {
      _error = "Unable to load feedback: $e";
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
