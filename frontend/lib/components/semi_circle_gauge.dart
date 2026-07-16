import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Shared semicircle score gauge (180° arc): background track + progress arc
/// with rounded caps, and a builder-provided center content slot.
/// Used by the Job Match screen and the feedback report score card.
class SemiCircleGauge extends StatelessWidget {
  final double progress; // 0.0 - 1.0
  final Color color;
  final Color trackColor;
  final double width;
  final double strokeWidth;
  final Widget? center;

  const SemiCircleGauge({
    super.key,
    required this.progress,
    required this.color,
    required this.trackColor,
    this.width = 200,
    this.strokeWidth = 14,
    this.center,
  });

  @override
  Widget build(BuildContext context) {
    // OVERFLOW FIX (yellow/black stripes in the feedback score card): the
    // 0.55 height ratio left the bottom-aligned center content a few pixels
    // short. Taller canvas + a scale-down FittedBox make overflow impossible
    // at any font scale or score width.
    return SizedBox(
      width: width,
      height: width * 0.62,
      child: CustomPaint(
        painter: _SemiCircleGaugePainter(
          progress: progress,
          color: color,
          trackColor: trackColor,
          strokeWidth: strokeWidth,
        ),
        child: center == null
            ? null
            : Align(
                alignment: Alignment.bottomCenter,
                child: FittedBox(fit: BoxFit.scaleDown, child: center),
              ),
      ),
    );
  }
}

class _SemiCircleGaugePainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color trackColor;
  final double strokeWidth;

  _SemiCircleGaugePainter({
    required this.progress,
    required this.color,
    required this.trackColor,
    required this.strokeWidth,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height);
    final radius = math.min(size.width / 2, size.height) - strokeWidth / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    canvas.drawArc(rect, math.pi, math.pi, false, Paint()
      ..color = trackColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round);

    canvas.drawArc(rect, math.pi, math.pi * progress.clamp(0.0, 1.0), false, Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round);
  }

  @override
  bool shouldRepaint(covariant _SemiCircleGaugePainter old) =>
      old.progress != progress || old.color != color;
}
