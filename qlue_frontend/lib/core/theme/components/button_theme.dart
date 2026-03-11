import 'package:flutter/material.dart';
import '../../constants/qlue_colors.dart';

/// Qlue Button Themes
/// Covers: ElevatedButton, OutlinedButton, TextButton

class QlueButtonTheme {
  QlueButtonTheme._();

  static const _size = Size(double.infinity, 52);
  static const _padding = EdgeInsets.symmetric(horizontal: 24, vertical: 14);
  static const _shape = RoundedRectangleBorder(
    borderRadius: BorderRadius.all(Radius.circular(12)),
  );

  // ── ElevatedButton ──────────────────────────────────────────────────────
  static ElevatedButtonThemeData elevated(
      ColorScheme scheme, bool isLight) {
    return ElevatedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return isLight ? QlueColors.primary[100] : QlueColors.primary[800];
          }
          if (states.contains(WidgetState.pressed)) {
            return isLight ? QlueColors.primary[700] : QlueColors.primary[600];
          }
          if (states.contains(WidgetState.hovered)) {
            return isLight ? QlueColors.primary[600] : QlueColors.primary[500];
          }
          return scheme.primary;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return isLight
                ? QlueColors.lightTextDisabled
                : QlueColors.darkTextDisabled;
          }
          return isLight ? Colors.white : QlueColors.darkBackgroundPrimary;
        }),
        overlayColor: WidgetStateProperty.all(Colors.transparent),
        elevation: WidgetStateProperty.all(0),
        shadowColor: WidgetStateProperty.all(Colors.transparent),
        minimumSize: WidgetStateProperty.all(_size),
        padding: WidgetStateProperty.all(_padding),
        shape: WidgetStateProperty.all(_shape),
      ),
    );
  }

  // ── OutlinedButton ──────────────────────────────────────────────────────
  static OutlinedButtonThemeData outlined(
      ColorScheme scheme, bool isLight) {
    final borderColor = isLight
        ? QlueColors.lightBorderDefault
        : QlueColors.darkBorderDefault;

    return OutlinedButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return isLight
                ? QlueColors.lightTextDisabled
                : QlueColors.darkTextDisabled;
          }
          return scheme.primary;
        }),
        side: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return BorderSide(color: borderColor);
          }
          if (states.contains(WidgetState.focused) ||
              states.contains(WidgetState.pressed)) {
            return BorderSide(color: scheme.primary, width: 2);
          }
          return BorderSide(color: borderColor, width: 1.5);
        }),
        backgroundColor: WidgetStateProperty.all(Colors.transparent),
        overlayColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.pressed)) {
            return scheme.primary.withValues(alpha: 0.08);
          }
          if (states.contains(WidgetState.hovered)) {
            return scheme.primary.withValues(alpha: 0.04);
          }
          return Colors.transparent;
        }),
        elevation: WidgetStateProperty.all(0),
        minimumSize: WidgetStateProperty.all(_size),
        padding: WidgetStateProperty.all(_padding),
        shape: WidgetStateProperty.all(_shape),
      ),
    );
  }

  // ── TextButton ──────────────────────────────────────────────────────────
  static TextButtonThemeData text(ColorScheme scheme, bool isLight) {
    return TextButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return isLight
                ? QlueColors.lightTextDisabled
                : QlueColors.darkTextDisabled;
          }
          return scheme.primary;
        }),
        overlayColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.pressed)) {
            return scheme.primary.withValues(alpha: 0.1);
          }
          if (states.contains(WidgetState.hovered)) {
            return scheme.primary.withValues(alpha: 0.05);
          }
          return Colors.transparent;
        }),
        elevation: WidgetStateProperty.all(0),
        padding: WidgetStateProperty.all(
          const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        ),
        shape: WidgetStateProperty.all(
          const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(8)),
          ),
        ),
      ),
    );
  }
}