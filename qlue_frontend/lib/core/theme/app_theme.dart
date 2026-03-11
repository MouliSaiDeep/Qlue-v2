import 'package:flutter/material.dart';
import '../constants/qlue_colors.dart';
import 'color_scheme.dart';
import 'text_theme.dart';
import 'components/button_theme.dart';
import 'components/card_theme.dart';
import 'components/dialog_theme.dart';
import 'components/input_theme.dart';
import 'components/misc_theme.dart';
import 'components/navigation_theme.dart';

/// Qlue AppTheme
///
/// Assembles light and dark ThemeData from component theme files.
/// To change any component's look, edit its dedicated file —
/// this file never needs to change.
///
/// Usage:
///   MaterialApp.router(
///     theme: AppTheme.light,
///     darkTheme: AppTheme.dark,
///     themeMode: ref.watch(themeModeProvider),
///   )
///


class AppTheme {
  AppTheme._();

  static ThemeData get light => _build(
        scheme: QlueColorScheme.light,
        brightness: Brightness.light,
      );

  static ThemeData get dark => _build(
        scheme: QlueColorScheme.dark,
        brightness: Brightness.dark,
      );

  static ThemeData _build({
    required ColorScheme scheme,
    required Brightness brightness,
  }) {
    final isLight = brightness == Brightness.light;
    final textTheme = QlueTextTheme.build(brightness);

    return ThemeData(
      useMaterial3: true,
      // brightness is intentionally omitted — colorScheme.brightness is the
      // single source of truth in Material 3. Passing both causes a redundancy
      // warning in Flutter 3.x and can produce inconsistent resolved colors.
      colorScheme: scheme,
      fontFamily: 'Inter',
      scaffoldBackgroundColor: isLight
          ? QlueColors.lightBackgroundPrimary
          : QlueColors.darkBackgroundPrimary,
      textTheme: textTheme,

      // ── Navigation ──────────────────────────────────────────────────────
      appBarTheme:
          QlueNavigationTheme.appBar(scheme, textTheme, isLight),
      navigationBarTheme:
          QlueNavigationTheme.navigationBar(scheme, textTheme, isLight),
      tabBarTheme:
          QlueNavigationTheme.tabBar(scheme, textTheme, isLight),

      // ── Buttons ─────────────────────────────────────────────────────────
      elevatedButtonTheme: QlueButtonTheme.elevated(scheme, isLight),
      outlinedButtonTheme: QlueButtonTheme.outlined(scheme, isLight),
      textButtonTheme: QlueButtonTheme.text(scheme, isLight),

      // ── Input ────────────────────────────────────────────────────────────
      inputDecorationTheme:
          QlueInputTheme.build(scheme, textTheme, isLight),

      // ── Surfaces ─────────────────────────────────────────────────────────
      cardTheme: QlueCardTheme.build(isLight),
      dialogTheme: QlueDialogTheme.dialog(scheme, textTheme, isLight),
      bottomSheetTheme: QlueDialogTheme.bottomSheet(isLight),

      // ── Misc ─────────────────────────────────────────────────────────────
      chipTheme: QlueMiscTheme.chip(scheme, textTheme, isLight),
      dividerTheme: QlueMiscTheme.divider(isLight),
      snackBarTheme: QlueMiscTheme.snackBar(scheme, textTheme, isLight),
      switchTheme: QlueMiscTheme.switchTheme(scheme, isLight),
      checkboxTheme: QlueMiscTheme.checkbox(scheme, isLight),
      progressIndicatorTheme:
          QlueMiscTheme.progressIndicator(scheme, isLight),
    );
  }
}