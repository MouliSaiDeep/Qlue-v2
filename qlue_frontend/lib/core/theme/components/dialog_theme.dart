import 'package:flutter/material.dart';
import '../../constants/qlue_colors.dart';

/// Qlue Dialog Themes
/// Covers: DialogTheme, BottomSheetThemeData


class QlueDialogTheme {
  QlueDialogTheme._();

  static DialogThemeData dialog(
      ColorScheme scheme, TextTheme textTheme, bool isLight) {
    final bgColor = isLight
        ? QlueColors.lightBackgroundPrimary
        : QlueColors.darkBackgroundSecondary;

    return DialogThemeData(
      backgroundColor: bgColor,
      elevation: 8,
      shadowColor: scheme.shadow,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(24)),
      ),
      titleTextStyle: textTheme.titleLarge,
      contentTextStyle: textTheme.bodyMedium,
    );
  }

  static BottomSheetThemeData bottomSheet(bool isLight) {
    final bgColor = isLight
        ? QlueColors.lightBackgroundPrimary
        : QlueColors.darkBackgroundSecondary;
    final dragHandleColor = isLight
        ? QlueColors.lightBorderStrong
        : QlueColors.darkBorderStrong;

    return BottomSheetThemeData(
      backgroundColor: bgColor,
      modalBackgroundColor: bgColor,
      elevation: 0,
      modalElevation: 16,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      showDragHandle: true,
      dragHandleColor: dragHandleColor,
      dragHandleSize: const Size(36, 4),
      clipBehavior: Clip.antiAlias,
    );
  }
}