import 'package:flutter/material.dart';
import '../core/services/feedback_api_service.dart';
import '../core/models/feedback_report_model.dart';

class FeedbackProvider with ChangeNotifier {
  final FeedbackApiService _apiService;
  
  bool _isLoading = false;
  String? _error;
  FeedbackReportModel? _report;

  FeedbackProvider({FeedbackApiService? apiService}) 
    : _apiService = apiService ?? FeedbackApiService();

  bool get isLoading => _isLoading;
  String? get error => _error;
  FeedbackReportModel? get report => _report;

  void clear() {
    _report = null;
    _error = null;
    _isLoading = false;
    notifyListeners();
  }

  Future<void> fetchReport(String sessionId, {int retries = 10}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _report = await _apiService.getFeedbackReport(sessionId);
      
      if (_report == null && retries > 0) {
        // Simple polling logic as implied by the test
        await Future.delayed(const Duration(seconds: 2));
        return fetchReport(sessionId, retries: retries - 1);
      }
      
      if (_report == null) {
        _error = "Unable to load feedback at this time. It may still be generating.";
      }
    } catch (e) {
      _error = "Unable to load feedback: ${e.toString()}";
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
