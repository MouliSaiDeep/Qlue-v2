import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// User-controllable UI appearance settings, persisted across launches.
///
/// This is the customization foundation: "Liquid Glass" ships as the default
/// style, but the user owns the dials — style, glass intensity, and motion —
/// from Profile -> Appearance.
class AppearanceProvider extends ChangeNotifier {
  static const _kStyle = 'appearance.glassStyle';
  static const _kIntensity = 'appearance.glassIntensity';
  static const _kReduceMotion = 'appearance.reduceMotion';

  /// 'liquid' (default) or 'classic' (the previous look).
  String _glassStyle = 'liquid';
  String get glassStyle => _glassStyle;
  bool get isLiquid => _glassStyle == 'liquid';

  /// 0.6 (subtle) .. 1.4 (heavy). Multiplies blur and highlight strength.
  double _glassIntensity = 1.0;
  double get glassIntensity => _glassIntensity;

  /// Disables ambient/background animations for battery and calm.
  bool _reduceMotion = false;
  bool get reduceMotion => _reduceMotion;

  AppearanceProvider() {
    _load();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _glassStyle = prefs.getString(_kStyle) ?? 'liquid';
      _glassIntensity = (prefs.getDouble(_kIntensity) ?? 1.0).clamp(0.6, 1.4);
      _reduceMotion = prefs.getBool(_kReduceMotion) ?? false;
      notifyListeners();
    } catch (_) {
      // Defaults remain; appearance must never block startup.
    }
  }

  Future<void> setGlassStyle(String style) async {
    if (style != 'liquid' && style != 'classic') return;
    _glassStyle = style;
    notifyListeners();
    (await SharedPreferences.getInstance()).setString(_kStyle, style);
  }

  Future<void> setGlassIntensity(double value) async {
    _glassIntensity = value.clamp(0.6, 1.4);
    notifyListeners();
    (await SharedPreferences.getInstance()).setDouble(_kIntensity, _glassIntensity);
  }

  Future<void> setReduceMotion(bool value) async {
    _reduceMotion = value;
    notifyListeners();
    (await SharedPreferences.getInstance()).setBool(_kReduceMotion, value);
  }
}
