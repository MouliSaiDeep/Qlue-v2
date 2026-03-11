import 'package:flutter/material.dart';
import '../../constants/qlue_colors.dart';

/// Qlue Input Theme
/// Covers: InputDecorationTheme


class QlueInputTheme {
  QlueInputTheme._();

  static InputDecorationTheme build(
      ColorScheme scheme, TextTheme textTheme, bool isLight) {
    final borderColor = isLight
        ? QlueColors.lightBorderDefault
        : QlueColors.darkBorderDefault;
    final subtleBorderColor = isLight
        ? QlueColors.lightBorderSubtle
        : QlueColors.darkBorderSubtle;
    final fillColor = isLight
        ? QlueColors.lightBackgroundSecondary
        : QlueColors.darkBackgroundSecondary;
    final hintColor = isLight
        ? QlueColors.lightTextDisabled
        : QlueColors.darkTextDisabled;
    final labelColor = isLight
        ? QlueColors.lightTextSecondary
        : QlueColors.darkTextSecondary;
    final helperColor = isLight
        ? QlueColors.lightTextTertiary
        : QlueColors.darkTextTertiary;

    return InputDecorationTheme(
      filled: true,
      fillColor: fillColor,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      hintStyle: textTheme.bodyMedium?.copyWith(color: hintColor),
      labelStyle: textTheme.bodyMedium?.copyWith(color: labelColor),
      floatingLabelStyle: textTheme.labelSmall?.copyWith(
        color: scheme.primary,
        fontWeight: FontWeight.w600,
      ),
      errorStyle: textTheme.labelSmall?.copyWith(color: scheme.error),
      helperStyle: textTheme.labelSmall?.copyWith(color: helperColor),
      prefixIconColor: WidgetStateColor.resolveWith((states) {
        if (states.contains(WidgetState.focused)) return scheme.primary;
        return labelColor;
      }),
      suffixIconColor: WidgetStateColor.resolveWith((states) {
        if (states.contains(WidgetState.error)) return scheme.error;
        if (states.contains(WidgetState.focused)) return scheme.primary;
        return labelColor;
      }),
      border: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: borderColor, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: borderColor, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: scheme.primary, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: scheme.error, width: 1.5),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: scheme.error, width: 2),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(12)),
        borderSide: BorderSide(color: subtleBorderColor, width: 1.5),
      ),
    );
  }
}