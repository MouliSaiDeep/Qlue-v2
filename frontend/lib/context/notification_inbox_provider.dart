import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/models/session_model.dart';
import '../core/services/dashboard_api_service.dart';
import '../core/update_service.dart';
import 'dashboard_provider.dart';

sealed class InboxNotification {
  const InboxNotification();

  String get id;
  DateTime? get date;
}

class FeedbackNotification extends InboxNotification {
  const FeedbackNotification(this.session, this.status);

  final SessionModel session;
  final SessionFeedbackStatus status;

  @override
  String get id =>
      'feedback:${session.sessionId}:${session.feedbackAttempt ?? ''}:${status.name}';

  @override
  DateTime get date => session.feedbackActivityAt ?? session.startedAt;
}

class AppUpdateNotification extends InboxNotification {
  const AppUpdateNotification(this.update);

  final UpdateInfo update;

  @override
  String get id => 'update:${update.version}';

  @override
  DateTime? get date => update.publishedAt;
}

class NotificationInboxProvider extends ChangeNotifier {
  NotificationInboxProvider({
    required String userId,
    required DashboardProvider dashboard,
    DashboardApiService? apiService,
    UpdateService? updateService,
  }) : _dashboard = dashboard,
       _apiService = apiService ?? DashboardApiService(),
       _updateService =
           updateService ??
           (UpdateService.isSupported ? UpdateService.shared : null),
       _readKey = userId.isEmpty ? null : 'notifications.read.$userId' {
    _dashboard.addListener(_syncDashboard);
    _updateService?.availableUpdate.addListener(_rebuildItems);
    _syncDashboard();
    _preferences = _restoreRead();
  }

  final DashboardProvider _dashboard;
  final DashboardApiService _apiService;
  final UpdateService? _updateService;
  final String? _readKey;
  final _readIds = <String>{};
  late final Future<SharedPreferences?> _preferences;
  Future<void> _pendingSave = Future.value();
  bool _readLoaded = false;
  bool _disposed = false;

  final _sessions = <String, SessionModel>{};
  List<SessionModel>? _recent;
  SessionHistoryPage? _page;
  SessionHistoryPage? _failedAfter;
  final _seenCursors = <String>{};
  bool _loading = false;
  String? _error;
  List<InboxNotification> _items = const [];

  List<InboxNotification> get items => _items;
  bool get hasUnread => _items.any(isUnread);
  bool get isLoading => _loading;
  bool get hasLoadedFeedback => _page != null;
  bool get canLoadOlder => _page?.nextCursor != null;
  String? get error => _error;

  bool isUnread(InboxNotification item) =>
      _readLoaded && !_readIds.contains(item.id);

  void markRead(InboxNotification item) {
    if (!_readIds.add(item.id)) return;
    notifyListeners();
    final key = _readKey;
    if (key == null) return;
    _pendingSave = _pendingSave
        .then((_) async {
          final prefs = await _preferences;
          if (prefs == null) return;
          final ids = {...?prefs.getStringList(key), ..._readIds};
          await prefs.setStringList(key, ids.toList());
        })
        .catchError((Object _) {
          // Read state remains available in the current session.
        });
  }

  Future<SharedPreferences?> _restoreRead() async {
    SharedPreferences? prefs;
    try {
      final key = _readKey;
      if (key != null) {
        prefs = await SharedPreferences.getInstance();
        _readIds.addAll(prefs.getStringList(key) ?? const []);
      }
    } catch (_) {
      // The inbox remains usable if device storage is unavailable.
    }
    _readLoaded = true;
    if (!_disposed && _items.isNotEmpty && _readKey != null) notifyListeners();
    return prefs;
  }

  Future<void> refresh() async {
    await Future.wait([_loadHistory(), _checkForUpdate()]);
  }

  Future<void> loadOlder() async {
    final page = _page;
    if (page?.nextCursor != null) await _loadHistory(after: page);
  }

  Future<void> retry() => _loadHistory(after: _failedAfter);

  Future<void> _checkForUpdate() async {
    try {
      await _updateService?.checkForUpdate();
    } catch (_) {
      // Keep feedback and the last known release available offline.
    }
  }

  Future<void> _loadHistory({SessionHistoryPage? after}) async {
    if (_disposed || _loading) return;
    final recentAtStart = _recent;
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final page = await _apiService.getHistoryPage(limit: 25, after: after);
      if (_disposed) return;
      if (after == null) _seenCursors.clear();
      final cursor = page.nextCursor;
      if (cursor != null && !_seenCursors.add(cursor)) {
        throw StateError('History pagination did not advance.');
      }
      final freshIds = identical(recentAtStart, _recent)
          ? const <String>{}
          : _recent!.map((session) => session.sessionId).toSet();
      for (final session in page.sessions) {
        if (session.sessionId.isNotEmpty &&
            !freshIds.contains(session.sessionId)) {
          _sessions[session.sessionId] = session;
        }
      }
      _page = page;
    } catch (_) {
      _failedAfter = after;
      _error = 'Couldn’t load feedback notifications. Try again.';
    } finally {
      _loading = false;
      if (!_disposed) _rebuildItems();
    }
  }

  void _syncDashboard() {
    final recent = _dashboard.recentHistory;
    if (identical(_recent, recent)) return;
    _recent = recent;
    for (final session in recent) {
      if (session.sessionId.isNotEmpty) _sessions[session.sessionId] = session;
    }
    _rebuildItems();
  }

  void _rebuildItems() {
    final update = _updateService?.availableUpdate.value;
    final items = <InboxNotification>[
      if (update != null) AppUpdateNotification(update),
      for (final session in _sessions.values)
        if (session.feedbackStatus case final status?)
          FeedbackNotification(session, status),
    ];
    items.sort((a, b) {
      final dateOrder = (b.date?.millisecondsSinceEpoch ?? 0).compareTo(
        a.date?.millisecondsSinceEpoch ?? 0,
      );
      return dateOrder == 0 ? a.id.compareTo(b.id) : dateOrder;
    });
    _items = List.unmodifiable(items);
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _dashboard.removeListener(_syncDashboard);
    _updateService?.availableUpdate.removeListener(_rebuildItems);
    super.dispose();
  }
}
