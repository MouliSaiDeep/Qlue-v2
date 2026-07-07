import 'dart:async';

import 'package:flutter/material.dart';
import '../core/models/dashboard_model.dart';
import '../core/models/session_model.dart';
import '../core/services/dashboard_api_service.dart';

class DashboardProvider extends ChangeNotifier {
  final DashboardApiService _apiService = DashboardApiService();

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

  // REALTIME REFRESH: keeps dashboard/history data current without the user
  // switching screens. Silent fetches never toggle isLoading (no spinner or
  // empty-state flicker) and keep the last good data on transient errors.
  Timer? _autoRefreshTimer;
  DateTime? _lastFetchedAt;
  bool _fetchInFlight = false;
  static const Duration autoRefreshInterval = Duration(seconds: 45);
  static const Duration _minRefreshGap = Duration(seconds: 10);

  bool get isAutoRefreshing => _autoRefreshTimer != null;

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  Future<void> fetchDashboardData({bool silent = false}) async {
    if (_fetchInFlight) return; // never stack overlapping fetches
    _fetchInFlight = true;
    try {
      if (!silent) {
        _setLoading(true);
        _error = null;
      }

      // Fetch sumary, stats and history in parallel
      final results = await Future.wait([
        _apiService.getSummary(),
        _apiService.getModuleStats(),
        _apiService.getHistory(limit: 5),
      ]);

      _summary = results[0] as DashboardSummary;
      _radarData = results[1] as RadarData;
      _history = results[2] as List<SessionModel>;
      _lastFetchedAt = DateTime.now();
      _error = null;

      if (silent) notifyListeners(); // non-silent path notifies via _setLoading
    } catch (e) {
      if (!silent) {
        _error = "Failed to load dashboard data.";
      }
      // Silent refresh failures keep showing the last good data.
    } finally {
      _fetchInFlight = false;
      if (!silent) _setLoading(false);
    }
  }

  /// Immediate silent refresh, throttled so rapid tab switches don't spam
  /// the backend (and the AWS bill).
  Future<void> refreshNow() async {
    final last = _lastFetchedAt;
    if (last != null && DateTime.now().difference(last) < _minRefreshGap) {
      return;
    }
    await fetchDashboardData(silent: true);
  }

  /// Starts periodic background refresh. Idempotent.
  void startAutoRefresh() {
    if (_autoRefreshTimer != null) return;
    _autoRefreshTimer = Timer.periodic(
      autoRefreshInterval,
      (_) => fetchDashboardData(silent: true),
    );
  }

  void stopAutoRefresh() {
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = null;
  }

  @override
  void dispose() {
    stopAutoRefresh();
    super.dispose();
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
