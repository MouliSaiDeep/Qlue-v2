import 'dart:math' show pi, cos, sin, min;
import 'package:flutter/material.dart';
import '../core/theme.dart';

class SpiderChart extends StatelessWidget {
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
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: SpiderChartPainter(
          data: data,
          maxValue: maxValue,
          t: t,
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
    // Reduce radius to leave room for text labels
    final radius = min(size.width, size.height) / 2 * 0.70;
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
          fontSize: 11,
          fontWeight: FontWeight.w600,
          height: 1.1,
        ),
      );
      final textPainter = TextPainter(
        text: textSpan,
        textAlign: TextAlign.center,
        textDirection: TextDirection.ltr,
      );
      textPainter.layout(minWidth: 0, maxWidth: 65);

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
      ..color = t.primary.withOpacity(0.25)
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
    return true;
  }
}
