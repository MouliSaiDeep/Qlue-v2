import 'package:flutter/material.dart';
import '../../constants/qlue_colors.dart';

/// Qlue Misc Themes
/// Covers: Chip, Divider, SnackBar, Switch, Checkbox, ProgressIndicator


class QlueMiscTheme {
  QlueMiscTheme._();

  // ── Chip ──────────────────────────────────────────────────────────────────
  static ChipThemeData chip(
      ColorScheme scheme, TextTheme textTheme, bool isLight) {
    return ChipThemeData(
      backgroundColor: isLight
          ? QlueColors.lightBackgroundSecondary
          : QlueColors.darkBackgroundSecondary,
      selectedColor:
          isLight ? QlueColors.primary[100]! : QlueColors.primary[800]!,
      disabledColor: isLight
          ? QlueColors.lightBackgroundTertiary
          : QlueColors.darkBackgroundTertiary,
      labelStyle: textTheme.labelMedium,
      secondaryLabelStyle:
          textTheme.labelMedium?.copyWith(color: scheme.primary),
      side: BorderSide(
        color: isLight
            ? QlueColors.lightBorderDefault
            : QlueColors.darkBorderDefault,
      ),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(8)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      elevation: 0,
      pressElevation: 0,
    );
  }

  // ── Divider ───────────────────────────────────────────────────────────────
  static DividerThemeData divider(bool isLight) {
    return DividerThemeData(
      color: isLight ? QlueColors.lightDivider : QlueColors.darkDivider,
      thickness: 1,
      space: 0,
    );
  }

  // ── SnackBar ──────────────────────────────────────────────────────────────
  static SnackBarThemeData snackBar(
      ColorScheme scheme, TextTheme textTheme, bool isLight) {
    final bgColor = isLight
        ? QlueColors.neutral[900]!
        : QlueColors.darkBackgroundTertiary;
    final fgColor =
        isLight ? Colors.white : QlueColors.darkTextPrimary;

    return SnackBarThemeData(
      backgroundColor: bgColor,
      contentTextStyle: textTheme.bodyMedium?.copyWith(color: fgColor),
      actionTextColor: QlueColors.primary[300],
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(12)),
      ),
      behavior: SnackBarBehavior.floating,
      elevation: 4,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    );
  }

  // ── Switch ────────────────────────────────────────────────────────────────
  static SwitchThemeData switchTheme(ColorScheme scheme, bool isLight) {
    return SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return Colors.white;
        return isLight
            ? QlueColors.lightTextDisabled
            : QlueColors.darkTextDisabled;
      }),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return isLight
              ? QlueColors.lightBackgroundTertiary
              : QlueColors.darkBackgroundTertiary;
        }
        if (states.contains(WidgetState.selected)) return scheme.primary;
        return isLight
            ? QlueColors.lightBackgroundSecondary
            : QlueColors.darkBackgroundTertiary;
      }),
      trackOutlineColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return Colors.transparent;
        return isLight
            ? QlueColors.lightBorderDefault
            : QlueColors.darkBorderDefault;
      }),
      overlayColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.pressed)) {
          return scheme.primary.withValues(alpha: 0.12);
        }
        return Colors.transparent;
      }),
    );
  }

  // ── Checkbox ──────────────────────────────────────────────────────────────
  static CheckboxThemeData checkbox(ColorScheme scheme, bool isLight) {
    return CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return isLight
              ? QlueColors.lightTextDisabled
              : QlueColors.darkTextDisabled;
        }
        if (states.contains(WidgetState.selected)) return scheme.primary;
        return Colors.transparent;
      }),
      checkColor: WidgetStateProperty.all(Colors.white),
      side: BorderSide(
        color: isLight
            ? QlueColors.lightBorderDefault
            : QlueColors.darkBorderDefault,
        width: 1.5,
      ),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(6)),
      ),
      overlayColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.pressed)) {
          return scheme.primary.withValues(alpha: 0.12);
        }
        return Colors.transparent;
      }),
    );
  }

  // ── ProgressIndicator ─────────────────────────────────────────────────────
  static ProgressIndicatorThemeData progressIndicator(
      ColorScheme scheme, bool isLight) {
    return ProgressIndicatorThemeData(
      color: scheme.primary,
      linearTrackColor:
          isLight ? QlueColors.primary[100]! : QlueColors.primary[800]!,
      circularTrackColor:
          isLight ? QlueColors.primary[100]! : QlueColors.primary[800]!,
      linearMinHeight: 4,
      borderRadius: const BorderRadius.all(Radius.circular(6)),
    );
  }
}