import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

abstract interface class ScreenAwakePlatform {
  Future<void> setEnabled(bool enabled);
  Future<bool> get enabled;
}

class NativeScreenAwake implements ScreenAwakePlatform {
  @override
  Future<void> setEnabled(bool enabled) => WakelockPlus.toggle(enable: enabled);
  @override
  Future<bool> get enabled => WakelockPlus.enabled;
}

/// Serializes platform writes and reconciles against current owners after every
/// await. Old routes release only their own lease, never a newer route's lease.
class ScreenAwakeService extends ChangeNotifier {
  ScreenAwakeService({ScreenAwakePlatform? platform})
    : _platform = platform ?? NativeScreenAwake();
  static final shared = ScreenAwakeService();
  final ScreenAwakePlatform _platform;
  final Map<Object, bool> _owners = {};
  Future<void> _queue = Future.value();
  int _revision = 0;
  bool? _applied;
  String? error;
  bool get requested => _owners.values.any((active) => active);
  bool get protected => requested && _applied == true && error == null;
  Future<void> get settled => _queue;

  Future<void> update(Object owner, bool active, {bool force = false}) {
    if (_owners[owner] == active && !force) return _queue;
    _owners[owner] = active;
    _revision++;
    return _enqueue(force: force);
  }

  Future<void> release(Object owner) {
    _owners.remove(owner);
    _revision++;
    return _enqueue();
  }

  Future<void> _enqueue({bool force = false}) =>
      _queue = _queue.then((_) => _apply(force));
  Future<void> _apply(bool force) async {
    while (true) {
      final revision = _revision, desired = requested;
      if (_applied == desired && !force) return;
      var timedOut = false;
      try {
        final operation = _platform.setEnabled(desired);
        // If a native operation completes after timeout, reapply CURRENT
        // ownership. Its late success must not resurrect an abandoned enable.
        operation.then((_) {
          if (timedOut) {
            _applied = null;
            _enqueue(force: true);
          }
        }, onError: (Object _) {});
        try {
          await operation.timeout(const Duration(seconds: 5));
        } on TimeoutException {
          timedOut = true;
          rethrow;
        }
        final actual = await _platform.enabled.timeout(
          const Duration(seconds: 5),
        );
        if (actual != desired) {
          throw StateError('Screen-awake state did not apply');
        }
        _applied = actual;
        error = null;
      } catch (_) {
        _applied = null;
        error =
            'Screen-awake protection is unavailable. The screen may sleep; normal device settings still apply.';
      }
      notifyListeners();
      if (revision == _revision) return;
      force = true;
    }
  }
}
