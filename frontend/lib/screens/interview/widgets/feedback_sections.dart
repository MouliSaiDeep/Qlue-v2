import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
import '../../../core/theme.dart';

Widget buildFeedbackSectionTitle(
  AppThemeColors t,
  String title,
  IconData icon,
) {
  return Row(
    children: [
      Icon(icon, size: 20, color: t.accentGreen),
      const SizedBox(width: 10),
      Flexible(
        child: Text(
          title,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: t.text,
          ),
        ),
      ),
    ],
  );
}

Widget buildFeedbackMetricRow(
  AppThemeColors t,
  String label,
  String value,
  Color color,
) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 12.0),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Text(label, style: TextStyle(color: t.textSecondary)),
        ),
        const SizedBox(width: 12),
        Text(
          value,
          style: TextStyle(fontWeight: FontWeight.bold, color: color),
        ),
      ],
    ),
  );
}

Widget buildFeedbackBulletPoint(AppThemeColors t, String text, Color color) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 12.0),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          margin: const EdgeInsets.only(top: 6),
          width: 8,
          height: 8,
          decoration: BoxDecoration(shape: BoxShape.circle, color: color),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: TextStyle(fontSize: 14, color: t.textSecondary, height: 1.4),
          ),
        ),
      ],
    ),
  );
}

/// A labelled liquid-glass progress bar (label + percent on top, glass fill
/// below). Used in the Summary tab to visualise aggregate scores.
Widget buildFeedbackGlassStatBar(
  AppThemeColors t,
  String label,
  int percent,
  Color color,
) {
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 13, color: t.textSecondary),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            "$percent%",
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
      const SizedBox(height: 8),
      SizedBox(
        width: double.infinity,
        child: lg.GlassProgressIndicator.linear(
          value: (percent / 100).clamp(0.0, 1.0),
          height: 8,
          minWidth: 0,
          color: color,
          backgroundColor: t.metallicBorder.withValues(alpha: 0.18),
        ),
      ),
    ],
  );
}

/// A numbered action item for the "Recommended next steps" list — a small
/// glowing badge with the ordinal, then the recommendation text.
Widget buildFeedbackRecommendationItem(
  AppThemeColors t,
  int number,
  String text,
) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 14.0),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: t.accentGreen.withValues(alpha: 0.15),
            shape: BoxShape.circle,
            border: Border.all(color: t.accentGreen.withValues(alpha: 0.4)),
          ),
          child: Text(
            "$number",
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.bold,
              color: t.accentGreen,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              text,
              style: TextStyle(
                fontSize: 14,
                color: t.textSecondary,
                height: 1.5,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}
