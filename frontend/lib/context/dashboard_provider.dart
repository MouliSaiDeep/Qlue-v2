import 'package:flutter/material.dart';
import '../core/models/dashboard_model.dart';
import '../core/models/session_model.dart';
import '../core/services/dashboard_api_service.dart';

class DashboardProvider extends ChangeNotifier {
  final DashboardApiService _apiService;

  DashboardProvider({DashboardApiService? apiService})
      : _apiService = apiService ?? DashboardApiService();

  DashboardSummary _summary = DashboardSummary.initial();
  DashboardSummary get summary => _summary;

  RadarData _radarData = RadarData.initial();
  RadarData get radarData => _radarData;

  List<SessionModel> _history = [];
  List<SessionModel> get history => _history;

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  String? _error;
  String? get error => _error;

  // Stale flag: when true, the dashboard screen will re-fetch on next visit
  bool _isStale = false;
  bool get isStale => _isStale;

  /// Mark the dashboard as stale so it re-fetches on next visit.
  /// Call this after a session completes feedback generation.
  void markStale() {
    _isStale = true;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  Future<void> fetchDashboardData() async {
    try {
      _setLoading(true);
      _error = null;
      _isStale = false;

      // Fetch summary, stats and history in parallel
      final results = await Future.wait([
        _apiService.getSummary(),
        _apiService.getModuleStats(),
        _apiService.getHistory(limit: 5),
      ]);

      _summary = results[0] as DashboardSummary;
      _radarData = results[1] as RadarData;
      _history = results[2] as List<SessionModel>;

    } catch (e) {
      _error = "Failed to load dashboard data.";
    } finally {
      _setLoading(false);
    }
  }

  Future<void> fetchHistory({String? moduleType}) async {
    try {
      _setLoading(true);
      _error = null;
      _history = await _apiService.getHistory(moduleType: moduleType);
    } catch (e) {
      _error = "Failed to load history.";
    } finally {
      _setLoading(false);
    }
  }
}
