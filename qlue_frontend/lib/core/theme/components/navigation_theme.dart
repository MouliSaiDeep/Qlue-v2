import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../constants/qlue_colors.dart';

/// Qlue Navigation Themes
/// Covers: AppBarTheme, NavigationBarTheme, TabBarTheme


class QlueNavigationTheme {
  QlueNavigationTheme._();

  // ── AppBar ────────────────────────────────────────────────────────────────
  static AppBarTheme appBar(
      ColorScheme scheme, TextTheme textTheme, bool isLight) {
    final fg = isLight
        ? QlueColors.lightTextPrimary
        : QlueColors.darkTextPrimary;
    final bg = isLight
        ? QlueColors.lightBackgroundPrimary
        : QlueColors.darkBackgroundPrimary;

    return AppBarTheme(
      backgroundColor: bg,
      foregroundColor: fg,
      elevation: 0,
      scrolledUnderElevation: 1,
      shadowColor: scheme.shadow,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      titleTextStyle: textTheme.titleLarge?.copyWith(color: fg),
      iconTheme: IconThemeData(color: fg, size: 24),
      actionsIconTheme: IconThemeData(color: fg, size: 24),
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness:
            isLight ? Brightness.dark : Brightness.light,
        statusBarBrightness:
            isLight ? Brightness.light : Brightness.dark,
        systemNavigationBarColor: bg,
        systemNavigationBarIconBrightness:
            isLight ? Brightness.dark : Brightness.light,
      ),
    );
  }

  // ── NavigationBar (M3) ────────────────────────────────────────────────────
  static NavigationBarThemeData navigationBar(
      ColorScheme scheme, TextTheme textTheme, bool isLight) {
    final selectedColor =
        isLight ? QlueColors.primary[500]! : QlueColors.primary[400]!;
    final unselectedColor = isLight
        ? QlueColors.lightTextTertiary
        : QlueColors.darkTextTertiary;
    final indicatorColor =
        isLight ? QlueColors.primary[100]! : QlueColors.primary[800]!;

    return NavigationBarThemeData(
      backgroundColor: isLight
          ? QlueColors.lightBackgroundPrimary
          : QlueColors.darkBackgroundPrimary,
      indicatorColor: indicatorColor,
      elevation: 0,
      height: 64,
      surfaceTintColor: Colors.transparent,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final color = states.contains(WidgetState.selected)
            ? selectedColor
            : unselectedColor;
        return IconThemeData(color: color, size: 24);
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final isSelected = states.contains(WidgetState.selected);
        return textTheme.labelSmall?.copyWith(
          color: isSelected ? selectedColor : unselectedColor,
          fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
        );
      }),
    );
  }

  // ── TabBar ────────────────────────────────────────────────────────────────
  static TabBarThemeData tabBar(
      ColorScheme scheme, TextTheme textTheme, bool isLight) {
    final unselectedColor = isLight
        ? QlueColors.lightTextTertiary
        : QlueColors.darkTextTertiary;
    final dividerColor =
        isLight ? QlueColors.lightDivider : QlueColors.darkDivider;

    return TabBarThemeData(
      labelColor: scheme.primary,
      unselectedLabelColor: unselectedColor,
      labelStyle:
          textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600),
      unselectedLabelStyle: textTheme.labelLarge,
      indicator: UnderlineTabIndicator(
        borderSide: BorderSide(color: scheme.primary, width: 2),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
      ),
      indicatorSize: TabBarIndicatorSize.label,
      dividerColor: dividerColor,
      overlayColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.pressed)) {
          return scheme.primary.withValues(alpha: 0.08);
        }
        return Colors.transparent;
      }),
    );
  }
}