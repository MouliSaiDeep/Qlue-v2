import 'dart:math' show pi, cos, sin, min;
import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Animated radar/spider chart.
///
/// The chart smoothly morphs between value sets whenever [data] changes — a
/// new dashboard refresh, or the user switching the module in the dropdown —
/// so updates are visible instead of snapping in place. Axes are taken from
/// the incoming (target) data, and each dimension's value is tweened from what
/// is currently on screen to the new value (dimensions that only exist in the
/// new set grow out from the centre).
class SpiderChart extends StatefulWidget {
  final Map<String, double> data;
  final double maxValue;
  final double size;

  const SpiderChart({
    super.key,
    required this.data,
    this.maxValue = 1.0,
    this.size = 200,
  });

  @override
  State<SpiderChart> createState() => _SpiderChartState();
}

class _SpiderChartState extends State<SpiderChart>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _animation;

  // Values the current tween starts from (what was last on screen) and ends at.
  late Map<String, double> _begin;
  late Map<String, double> _end;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 650),
    );
    _animation = CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic);
    _end = Map<String, double>.from(widget.data);
    // First paint grows the polygon out from the centre.
    _begin = {for (final k in _end.keys) k: 0.0};
    _controller.forward();
  }

  @override
  void didUpdateWidget(covariant SpiderChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_mapsEqual(oldWidget.data, widget.data)) {
      // Re-tween from whatever is currently drawn so mid-flight changes stay
      // smooth instead of jumping.
      _begin = _currentFrame();
      _end = Map<String, double>.from(widget.data);
      _controller.forward(from: 0.0);
    }
  }

  /// The interpolated values for the current animation position, over the union
  /// of the begin/end dimensions (missing keys count as 0).
  Map<String, double> _currentFrame() {
    final v = _animation.value;
    final keys = <String>{..._begin.keys, ..._end.keys};
    return {
      for (final k in keys)
        k: (_begin[k] ?? 0.0) + ((_end[k] ?? 0.0) - (_begin[k] ?? 0.0)) * v,
    };
  }

  static bool _mapsEqual(Map<String, double> a, Map<String, double> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (final entry in a.entries) {
      if (b[entry.key] != entry.value) return false;
    }
    return true;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: RepaintBoundary(
        child: AnimatedBuilder(
          animation: _animation,
          builder: (context, _) {
            final v = _animation.value;
            // Axes follow the target set; values lerp begin -> end.
            final frame = <String, double>{
              for (final k in _end.keys)
                k: (_begin[k] ?? 0.0) + ((_end[k] ?? 0.0) - (_begin[k] ?? 0.0)) * v,
            };
            return CustomPaint(
              painter: SpiderChartPainter(
                data: frame,
                maxValue: widget.maxValue,
                t: t,
              ),
            );
          },
        ),
      ),
    );
  }
}

class SpiderChartPainter extends CustomPainter {
  final Map<String, double> data;
  final double maxValue;
  final AppThemeColors t;

  SpiderChartPainter({
    required this.data,
    required this.maxValue,
    required this.t,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (data.isEmpty) return;

    final center = Offset(size.width / 2, size.height / 2);
    // Reduce radius to leave room for full-name labels, which can wrap
    // onto two lines around the chart.
    final radius = min(size.width, size.height) / 2 * 0.62;
    final categories = data.keys.toList();
    final values = data.values.toList();
    final numPoints = categories.length;
    final angleStep = 2 * pi / numPoints;

    // Paint for the web rings Background
    final ringPaint = Paint()
      ..color = t.borderSubtle
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    // Paint for axes lines
    final axisPaint = Paint()
      ..color = t.borderSubtle
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    // 1. Draw web rings (4 concentric polygons)
    const numRings = 4;
    for (int i = 1; i <= numRings; i++) {
      final ringRadius = radius * (i / numRings);
      final ringPath = Path();
      for (int j = 0; j < numPoints; j++) {
        final angle = j * angleStep - pi / 2; // start at top (-90 degrees)
        final dx = center.dx + ringRadius * cos(angle);
        final dy = center.dy + ringRadius * sin(angle);
        if (j == 0) {
          ringPath.moveTo(dx, dy);
        } else {
          ringPath.lineTo(dx, dy);
        }
      }
      ringPath.close();
      canvas.drawPath(ringPath, ringPaint);
    }

    // 2. Draw axes and labels
    for (int j = 0; j < numPoints; j++) {
      final angle = j * angleStep - pi / 2;
      final dx = center.dx + radius * cos(angle);
      final dy = center.dy + radius * sin(angle);

      // axis line
      canvas.drawLine(center, Offset(dx, dy), axisPaint);

      // label
      final labelRadius = radius * 1.3;
      final labelDx = center.dx + labelRadius * cos(angle);
      final labelDy = center.dy + labelRadius * sin(angle);

      final textSpan = TextSpan(
        text: categories[j],
        style: TextStyle(
          color: t.textSecondary,
          fontSize: 10,
          fontWeight: FontWeight.w600,
          height: 1.15,
        ),
      );
      final textPainter = TextPainter(
        text: textSpan,
        textAlign: TextAlign.center,
        textDirection: TextDirection.ltr,
      );
      textPainter.layout(minWidth: 0, maxWidth: 74);

      canvas.save();
      // center text on the point
      canvas.translate(labelDx - textPainter.width / 2, labelDy - textPainter.height / 2);
      textPainter.paint(canvas, Offset.zero);
      canvas.restore();
    }

    // 3. Draw data polygon
    final dataPath = Path();
    for (int j = 0; j < numPoints; j++) {
      final angle = j * angleStep - pi / 2;
      final normalizedValue = (values[j] / maxValue).clamp(0.0, 1.0);
      final dataRadius = radius * normalizedValue;
      final dx = center.dx + dataRadius * cos(angle);
      final dy = center.dy + dataRadius * sin(angle);

      if (j == 0) {
        dataPath.moveTo(dx, dy);
      } else {
        dataPath.lineTo(dx, dy);
      }
    }
    dataPath.close();

    // Fill
    final fillPaint = Paint()
      ..color = t.primary.withValues(alpha: 0.25)
      ..style = PaintingStyle.fill;
    canvas.drawPath(dataPath, fillPaint);

    // Stroke
    final strokePaint = Paint()
      ..color = t.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0;
    canvas.drawPath(dataPath, strokePaint);

    // Draw points on vertices
    final pointPaint = Paint()
      ..color = t.primary
      ..style = PaintingStyle.fill;
    for (int j = 0; j < numPoints; j++) {
      final angle = j * angleStep - pi / 2;
      final normalizedValue = (values[j] / maxValue).clamp(0.0, 1.0);
      final dataRadius = radius * normalizedValue;
      final dx = center.dx + dataRadius * cos(angle);
      final dy = center.dy + dataRadius * sin(angle);

      // Paint white border around point
      canvas.drawCircle(Offset(dx, dy), 5.0, Paint()..color = t.card);
      // Internal point
      canvas.drawCircle(Offset(dx, dy), 3.5, pointPaint);
    }
  }

  @override
  bool shouldRepaint(covariant SpiderChartPainter oldDelegate) {
    // Content comparison, NOT reference: getDimensionsForModule (and the
    // animation frames) hand us a fresh Map each build, so an identity check
    // would either always repaint or, if a caller ever memoized the map,
    // silently stop repainting. Compare values so we repaint exactly when the
    // rendered shape actually changes.
    return oldDelegate.maxValue != maxValue ||
        oldDelegate.t != t ||
        !_SpiderChartState._mapsEqual(oldDelegate.data, data);
  }
}
