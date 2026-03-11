import 'package:flutter/material.dart';
import '../constants/qlue_colors.dart';

/// Qlue Text Theme
///
/// [_base] defines only font, size, weight, spacing and height —
/// no colors. Colors are applied separately via [build] using
/// TextTheme.apply(), which lets Flutter's component themes safely
/// call copyWith(color:) on top without any bleed-through.
///


class QlueTextTheme {
  QlueTextTheme._();

  static const String _font = 'Inter';

  // ── Color-neutral base — shape/size/weight only ──────────────────────────
  static const TextTheme _base = TextTheme(
    // Display — onboarding / splash
    displayLarge: TextStyle(
      fontFamily: _font, fontSize: 57, fontWeight: FontWeight.w700,
      letterSpacing: -0.25, height: 1.12,
    ),
    displayMedium: TextStyle(
      fontFamily: _font, fontSize: 45, fontWeight: FontWeight.w700,
      height: 1.16,
    ),
    displaySmall: TextStyle(
      fontFamily: _font, fontSize: 36, fontWeight: FontWeight.w600,
      height: 1.22,
    ),

    // Headline — screen titles
    headlineLarge: TextStyle(
      fontFamily: _font, fontSize: 32, fontWeight: FontWeight.w700,
      height: 1.25,
    ),
    headlineMedium: TextStyle(
      fontFamily: _font, fontSize: 28, fontWeight: FontWeight.w600,
      height: 1.29,
    ),
    headlineSmall: TextStyle(
      fontFamily: _font, fontSize: 24, fontWeight: FontWeight.w600,
      height: 1.33,
    ),

    // Title — card headers / appbar
    titleLarge: TextStyle(
      fontFamily: _font, fontSize: 22, fontWeight: FontWeight.w600,
      height: 1.27,
    ),
    titleMedium: TextStyle(
      fontFamily: _font, fontSize: 16, fontWeight: FontWeight.w600,
      letterSpacing: 0.15, height: 1.5,
    ),
    titleSmall: TextStyle(
      fontFamily: _font, fontSize: 14, fontWeight: FontWeight.w600,
      letterSpacing: 0.1, height: 1.43,
    ),

    // Body — content / descriptions
    bodyLarge: TextStyle(
      fontFamily: _font, fontSize: 16, fontWeight: FontWeight.w400,
      letterSpacing: 0.15, height: 1.5,
    ),
    bodyMedium: TextStyle(
      fontFamily: _font, fontSize: 14, fontWeight: FontWeight.w400,
      letterSpacing: 0.25, height: 1.43,
    ),
    bodySmall: TextStyle(
      fontFamily: _font, fontSize: 12, fontWeight: FontWeight.w400,
      letterSpacing: 0.4, height: 1.33,
    ),

    // Label — buttons / chips / tabs
    labelLarge: TextStyle(
      fontFamily: _font, fontSize: 14, fontWeight: FontWeight.w600,
      letterSpacing: 0.1, height: 1.43,
    ),
    labelMedium: TextStyle(
      fontFamily: _font, fontSize: 12, fontWeight: FontWeight.w500,
      letterSpacing: 0.5, height: 1.33,
    ),
    labelSmall: TextStyle(
      fontFamily: _font, fontSize: 11, fontWeight: FontWeight.w500,
      letterSpacing: 0.5, height: 1.45,
    ),
  );

  // ── Colored build — called once per theme ────────────────────────────────
  //
  // bodyColor   → bodyLarge / bodyMedium / bodySmall
  // displayColor → everything else (display, headline, title, label)
  //
  // Components that need a different color call .copyWith(color:) themselves.
  static TextTheme build(Brightness brightness) {
    final isLight = brightness == Brightness.light;

    return _base.apply(
      bodyColor: isLight
          ? QlueColors.lightTextSecondary   // softer default for body text
          : QlueColors.darkTextSecondary,
      displayColor: isLight
          ? QlueColors.lightTextPrimary     // strong for titles / labels
          : QlueColors.darkTextPrimary,
      decorationColor: isLight
          ? QlueColors.lightTextTertiary
          : QlueColors.darkTextTertiary,
    );
  }
}