import 'package:flutter/material.dart';
import '../constants/qlue_colors.dart';

/// Qlue Color Schemes
/// Light and dark ColorScheme definitions — consumed by AppTheme.

class QlueColorScheme {
  QlueColorScheme._();

  static const ColorScheme light = ColorScheme(
    brightness: Brightness.light,
    // Primary — Arctic Blue
    primary: Color(0xFF1A73C7),            // primary[500]
    onPrimary: Colors.white,
    primaryContainer: Color(0xFFE0EFFF),   // primary[100]
    onPrimaryContainer: Color(0xFF031E47), // primary[900]
    // Secondary — Mint Fresh
    secondary: Color(0xFF1A9D66),          // secondary[500]
    onSecondary: Colors.white,
    secondaryContainer: Color(0xFFD4F7E6), // secondary[100]
    onSecondaryContainer: Color(0xFF04301D),
    // Tertiary — Warm Amber
    tertiary: Color(0xFFFF9326),           // tertiary[500]
    onTertiary: Colors.white,
    tertiaryContainer: Color(0xFFFFF2D9),  // tertiary[100]
    onTertiaryContainer: Color(0xFF8A3E0A),
    // Error — Crimson Red
    error: Color(0xFFE84343),              // error[500]
    onError: Colors.white,
    errorContainer: Color(0xFFFEE5E5),     // error[100]
    onErrorContainer: Color(0xFF5C1515),
    // Surface
    surface: Color(0xFFFFFFFF),
    onSurface: Color(0xFF151B24),
    surfaceContainerHighest: Color(0xFFF7F8FA),
    onSurfaceVariant: Color(0xFF455266),
    // Outline
    outline: Color(0xFFD8DDE8),
    outlineVariant: Color(0xFFEDF0F5),
    // Misc
    shadow: Color(0x1A000000),
    scrim: Color(0x1A000000),
    inverseSurface: Color(0xFF0D0F12),
    onInverseSurface: Color(0xFFF0F2F5),
    inversePrimary: Color(0xFF7CB8E8),     // primary[300]
  );

  static const ColorScheme dark = ColorScheme(
    brightness: Brightness.dark,
    // Primary — slightly lighter for dark bg legibility
    primary: Color(0xFF3D94D4),            // primary[400]
    onPrimary: Color(0xFF0D0F12),
    primaryContainer: Color(0xFF063266),   // primary[800]
    onPrimaryContainer: Color(0xFFE0EFFF), // primary[100]
    // Secondary
    secondary: Color(0xFF35BC82),          // secondary[400]
    onSecondary: Color(0xFF0D0F12),
    secondaryContainer: Color(0xFF084A2F), // secondary[800]
    onSecondaryContainer: Color(0xFFD4F7E6),
    // Tertiary
    tertiary: Color(0xFFFFB04D),           // tertiary[400]
    onTertiary: Color(0xFF0D0F12),
    tertiaryContainer: Color(0xFFB3520F),  // tertiary[800]
    onTertiaryContainer: Color(0xFFFFF2D9),
    // Error
    error: Color(0xFFF86B6B),             // error[400]
    onError: Color(0xFF0D0F12),
    errorContainer: Color(0xFF7F1D1D),    // error[800]
    onErrorContainer: Color(0xFFFEE5E5),
    // Surface — OLED elevation system
    surface: Color(0xFF0D0F12),           // Level 0
    onSurface: Color(0xFFF0F2F5),
    surfaceContainerHighest: Color(0xFF161A1F), // Level 1
    onSurfaceVariant: Color(0xFFA8ADB5),
    // Outline
    outline: Color(0xFF2D333B),
    outlineVariant: Color(0xFF21262D),
    // Misc
    shadow: Color(0x33000000),
    scrim: Color(0x33000000),
    inverseSurface: Color(0xFFF7F8FA),
    onInverseSurface: Color(0xFF151B24),
    inversePrimary: Color(0xFF0D5AA8),    // primary[600]
  );
}