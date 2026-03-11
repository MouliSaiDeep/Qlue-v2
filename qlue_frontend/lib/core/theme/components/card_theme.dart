import 'package:flutter/material.dart';
import '../../constants/qlue_colors.dart';

/// Qlue Card Theme


class QlueCardTheme {
  QlueCardTheme._();

  static CardThemeData build(bool isLight) {
    return CardThemeData(
      color: isLight
          ? QlueColors.lightBackgroundPrimary
          : QlueColors.darkBackgroundSecondary,
      elevation: 0,
      shadowColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(16)),
        side: BorderSide(
          color: isLight
              ? QlueColors.lightBorderDefault
              : QlueColors.darkBorderDefault,
          width: 1,
        ),
      ),
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
    );
  }
}