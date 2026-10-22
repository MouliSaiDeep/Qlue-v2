import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Every axis comes from the saved report. No placeholder criteria or scores.
/// The accessible score buttons live beside this visual in the report screen.
class FeedbackRadarChart extends StatelessWidget {
  final Map<String, double> scores;
  final String? selectedCriterion;
  final ValueChanged<String> onSelected;
  final Color accent;
  final Color foreground;
  final Color Function(num) pointColor;
  final bool reduceMotion;

  const FeedbackRadarChart({
    super.key,
    required this.scores,
    required this.onSelected,
    required this.accent,
    required this.foreground,
    required this.pointColor,
    this.selectedCriterion,
    this.reduceMotion = false,
  });

  @override
  Widget build(BuildContext context) {
    if (scores.length < 3) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(constraints.maxWidth, 260);
        return Semantics(
          label:
              'Radar chart of ${scores.length} assessed criteria. Select a score below for details.',
          child: SizedBox(
            height: size.height,
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: reduceMotion ? 1 : 0, end: 1),
              duration: reduceMotion
                  ? Duration.zero
                  : const Duration(milliseconds: 700),
              curve: Curves.easeOutCubic,
              builder: (context, progress, _) {
                final painter = _RadarPainter(
                  scores.entries.toList(),
                  selectedCriterion,
                  accent,
                  foreground,
                  pointColor,
                  progress,
                  Theme.of(context).textTheme.bodySmall?.fontFamily,
                );
                return GestureDetector(
                  key: const Key('feedback-radar-plot'),
                  behavior: HitTestBehavior.opaque,
                  onTapUp: (details) {
                    final index = painter.criterionAt(
                      details.localPosition,
                      size,
                    );
                    if (index != null) onSelected(scores.keys.elementAt(index));
                  },
                  child: CustomPaint(size: size, painter: painter),
                );
              },
            ),
          ),
        );
      },
    );
  }
}

class _RadarPainter extends CustomPainter {
  final List<MapEntry<String, double>> scores;
  final String? selected;
  final Color accent, foreground;
  final Color Function(num) pointColor;
  final double progress;
  final String? fontFamily;
  _RadarPainter(
    this.scores,
    this.selected,
    this.accent,
    this.foreground,
    this.pointColor,
    this.progress,
    this.fontFamily,
  );

  Offset center(Size size) => Offset(size.width / 2, size.height / 2);
  double radius(Size size) =>
      math.min(math.max(32, (size.width - 112) / 2), size.height / 2 - 42);
  Offset vertex(Size size, int i, [double fraction = 1]) {
    final angle = -math.pi / 2 + 2 * math.pi * i / scores.length;
    return center(size) +
        Offset(math.cos(angle), math.sin(angle)) * radius(size) * fraction;
  }

  double fraction(int i) => (scores[i].value / 100).clamp(0.0, 1.0) * progress;

  (TextPainter, Rect) label(Size size, int i) {
    final point = vertex(size, i), dx = point.dx - center(size).dx;
    final right = dx > radius(size) * .6, left = dx < -radius(size) * .6;
    final width = right
        ? size.width - point.dx - 10
        : left
        ? point.dx - 10
        : math.min(140.0, size.width - 16);
    final text = TextPainter(
      text: TextSpan(
        text: scores[i].key,
        style: TextStyle(
          color: selected == scores[i].key ? accent : foreground,
          fontSize: 12,
          fontFamily: fontFamily,
          height: 1.2,
          fontWeight: selected == scores[i].key
              ? FontWeight.w700
              : FontWeight.w500,
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: right
          ? TextAlign.left
          : left
          ? TextAlign.right
          : TextAlign.center,
      maxLines: 2,
      ellipsis: '…',
    )..layout(maxWidth: math.max(24, width));
    final x = right
        ? point.dx + 10
        : left
        ? point.dx - 10 - text.width
        : point.dx - text.width / 2;
    final y = right || left
        ? point.dy - text.height / 2
        : point.dy < center(size).dy
        ? point.dy - text.height - 12
        : point.dy + 12;
    return (
      text,
      Rect.fromLTWH(
        x.clamp(0.0, math.max(0.0, size.width - text.width)),
        y.clamp(0.0, math.max(0.0, size.height - text.height)),
        text.width,
        text.height,
      ),
    );
  }

  int? criterionAt(Offset position, Size size) {
    // Labels and outer axis endpoints remain easy to hit even for a zero score.
    for (var i = 0; i < scores.length; i++) {
      if (label(size, i).$2.inflate(8).contains(position) ||
          (vertex(size, i) - position).distance <= 22) {
        return i;
      }
    }
    int? closest;
    var distance = 22.0;
    for (var i = 0; i < scores.length; i++) {
      final next = (vertex(size, i, fraction(i)) - position).distance;
      if (next < distance) {
        closest = i;
        distance = next;
      }
    }
    return closest;
  }

  Path polygon(Size size, double scale, {bool useScores = false}) {
    final path = Path();
    for (var i = 0; i < scores.length; i++) {
      final p = vertex(size, i, useScores ? fraction(i) : scale);
      if (i == 0) {
        path.moveTo(p.dx, p.dy);
      } else {
        path.lineTo(p.dx, p.dy);
      }
    }
    return path..close();
  }

  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()
      ..color = foreground.withValues(alpha: .14)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (var step = 1; step <= 4; step++) {
      canvas.drawPath(polygon(size, step / 4), grid);
    }
    for (var i = 0; i < scores.length; i++) {
      canvas.drawLine(
        center(size),
        vertex(size, i),
        Paint()
          ..color = (selected == scores[i].key ? accent : foreground)
              .withValues(alpha: .2)
          ..strokeWidth = 1,
      );
    }
    final data = polygon(size, 1, useScores: true);
    canvas.drawPath(
      data,
      Paint()
        ..color = accent.withValues(alpha: .16)
        ..style = PaintingStyle.fill,
    );
    canvas.drawPath(
      data,
      Paint()
        ..color = accent
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round,
    );
    for (var i = 0; i < scores.length; i++) {
      final point = vertex(size, i, fraction(i)),
          active = selected == scores[i].key;
      if (active) {
        canvas.drawCircle(
          point,
          11,
          Paint()..color = accent.withValues(alpha: .2),
        );
      }
      canvas.drawCircle(
        point,
        active ? 6 : 4.5,
        Paint()..color = pointColor(scores[i].value),
      );
      canvas.drawCircle(
        point,
        active ? 6 : 4.5,
        Paint()
          ..color = foreground
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
      final (text, rect) = label(size, i);
      text.paint(canvas, rect.topLeft);
    }
  }

  @override
  bool shouldRepaint(covariant _RadarPainter old) =>
      old.progress != progress ||
      old.selected != selected ||
      old.accent != accent ||
      old.foreground != foreground ||
      old.fontFamily != fontFamily ||
      old.scores.length != scores.length ||
      List.generate(
        scores.length,
        (i) =>
            old.scores[i].key != scores[i].key ||
            old.scores[i].value != scores[i].value,
      ).any((changed) => changed);
}
