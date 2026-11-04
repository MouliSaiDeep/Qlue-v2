import 'dart:async';

import 'package:flutter/material.dart';
import '../core/models/dashboard_model.dart';
import '../core/models/session_model.dart';
import '../core/services/dashboard_api_service.dart';

class DashboardProvider extends ChangeNotifier {
  bool _disposed = false;
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  DashboardProvider({DashboardApiService? apiService})
    : _apiService = apiService ?? DashboardApiService();

  final DashboardApiService _apiService;

  DashboardSummary _summary = DashboardSummary.initial();
  DashboardSummary get summary => _summary;

  RadarData _radarData = RadarData.initial();
  RadarData get radarData => _radarData;

  List<SessionModel> _history = [];
  List<SessionModel> _recentHistory = [];
  List<SessionModel> get recentHistory => _recentHistory;
  List<SessionModel> get history =>
      _hasLoadedHistory ? _history : _recentHistory;
  bool _hasLoadedHistory = false;
  bool get hasLoadedHistory => _hasLoadedHistory;
  bool _isHistoryLoading = false;
  bool get isHistoryLoading => _isHistoryLoading;
  String? _historyError;
  String? get historyError => _historyError;
  final _historyFetches = <String?, ({Future<void> future, int request})>{};
  int _historyRequest = 0;
  int _nextHistoryRequest = 0;
  int _recentVersion = 0;
  String? _loadedHistoryModule;

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  // STARTUP FLASH FIX: before the first fetch completes, neither the stat
  // cards nor the empty state should render (defaults flashed for a moment
  // and vanished). Screens gate on this instead of guessing.
  bool _hasLoadedOnce = false;
  bool get hasLoadedOnce => _hasLoadedOnce;

  String? _error;
  String? get error => _error;

  // REALTIME REFRESH: keeps dashboard/history data current without the user
  // switching screens. Silent fetches never toggle isLoading (no spinner or
  // empty-state flicker) and keep the last good data on transient errors.
  Timer? _autoRefreshTimer;
  DateTime? _lastFetchedAt;
  Future<void>? _dashboardFetch;
  static const Duration autoRefreshInterval = Duration(seconds: 45);
  static const Duration _minRefreshGap = Duration(seconds: 10);

  bool get isAutoRefreshing => _autoRefreshTimer != null;

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  Future<void> fetchDashboardData({bool silent = false}) {
    if (_disposed) return Future.value();
    final pending = _dashboardFetch;
    if (pending != null) return pending;
    // Install before notifying, so even a reentrant reader joins this request.
    final completion = Completer<void>();
    _dashboardFetch = completion.future;
    unawaited(
      _loadDashboard(
        silent: silent,
      ).then(completion.complete, onError: completion.completeError),
    );
    return completion.future;
  }

  Future<void> _loadDashboard({required bool silent}) async {
    try {
      _error = null;
      if (!silent) {
        _setLoading(true);
      }

      // Fetch sumary, stats and history in parallel
      final results = await Future.wait([
        _apiService.getSummary(),
        _apiService.getModuleStats(),
        _apiService.getHistory(limit: 5),
      ]);
      if (_disposed) return;

      _summary = results[0] as DashboardSummary;
      _radarData = results[1] as RadarData;
      // The dashboard's five recent rows must never replace the full timeline.
      _recentHistory = results[2] as List<SessionModel>;
      ++_recentVersion;
      if (_hasLoadedHistory) {
        _history = _mergeRecentHistory(_history, _loadedHistoryModule);
      }
      _lastFetchedAt = DateTime.now();
      _hasLoadedOnce = true;
      _error = null;
    } catch (e) {
      if (!_disposed && (!silent || !_hasLoadedOnce)) {
        _error = "Failed to load dashboard data.";
      }
      // Silent refresh failures keep showing the last good data.
    } finally {
      _dashboardFetch = null;
      if (!_disposed) {
        if (!silent) _isLoading = false;
        notifyListeners();
      }
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
    if (_disposed || _autoRefreshTimer != null) return;
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
    _disposed = true;
    stopAutoRefresh();
    super.dispose();
  }

  Future<void> fetchHistory({String? moduleType}) {
    if (_disposed) return Future.value();
    final pending = _historyFetches[moduleType];
    if (pending != null) {
      final selectionChanged = _historyRequest != pending.request;
      _historyRequest = pending.request;
      _isHistoryLoading = true;
      _historyError = null;
      if (selectionChanged) notifyListeners();
      return pending.future;
    }
    final completion = Completer<void>();
    final request = _historyRequest = ++_nextHistoryRequest;
    _historyFetches[moduleType] = (future: completion.future, request: request);
    unawaited(
      _loadHistory(
        moduleType,
        request,
      ).then(completion.complete, onError: completion.completeError),
    );
    return completion.future;
  }

  Future<void> _loadHistory(String? moduleType, int request) async {
    final recentVersion = _recentVersion;
    try {
      _isHistoryLoading = true;
      _historyError = null;
      notifyListeners();
      final history = await _apiService.getHistory(moduleType: moduleType);
      if (_disposed || request != _historyRequest) return;
      // A slow full-history response must not undo recent rows received while
      // it was pending. An explicit newer history read remains authoritative.
      _history = recentVersion == _recentVersion
          ? history
          : _mergeRecentHistory(history, moduleType);
      _loadedHistoryModule = moduleType;
      _hasLoadedHistory = true;
    } catch (e) {
      if (!_disposed && request == _historyRequest) {
        _historyError = "Failed to load history.";
      }
    } finally {
      _historyFetches.remove(moduleType);
      if (!_disposed && request == _historyRequest) {
        _isHistoryLoading = false;
        notifyListeners();
      }
    }
  }

  List<SessionModel> _mergeRecentHistory(
    List<SessionModel> history,
    String? moduleType,
  ) {
    // Reuse the existing five-row response: no additional API call or broader
    // database read. Absence from this partial page never deletes older rows.
    final recent = _recentHistory
        .where((s) => moduleType == null || s.moduleType == moduleType)
        .toList();
    if (recent.isEmpty) return history;
    final ids = recent.map((s) => s.sessionId).toSet();
    final merged = [
      ...recent,
      ...history.where((s) => !ids.contains(s.sessionId)),
    ];
    final order = {
      for (var i = 0; i < merged.length; i++) merged[i].sessionId: i,
    };
    merged.sort((a, b) {
      final date = b.startedAt.compareTo(a.startedAt);
      return date != 0
          ? date
          : order[a.sessionId]!.compareTo(order[b.sessionId]!);
    });
    return merged.take(100).toList();
  }
}
