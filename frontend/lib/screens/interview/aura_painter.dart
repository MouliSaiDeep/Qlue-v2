import 'dart:math' as math;
import 'package:flutter/material.dart';

class AiAuraPainter extends CustomPainter {
  final double time;
  final double intensity; // 0.0 to 1.0 (simulated voice amplitude)
  final Color baseColor;

  AiAuraPainter({
    required this.time,
    required this.baseColor,
    this.intensity = 0.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2.5;

    // 1. Draw the "Glass Core" (Inner Glow)
    final innerGlowPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          baseColor.withOpacity(0.3 + intensity * 0.4),
          baseColor.withOpacity(0.1),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: center, radius: radius * 1.5));
    canvas.drawCircle(center, radius * 1.5, innerGlowPaint);

    // 2. Draw Multi-Layered Morphing Blobs
    _drawMorphingBlob(canvas, center, radius * 0.9, 0.4, 1.0, 1.2);    // Core
    _drawMorphingBlob(canvas, center, radius * 1.1, 0.25, 0.8, 1.5);   // Middle
    _drawMorphingBlob(canvas, center, radius * 1.3, 0.15, 0.6, 2.0);   // Outer Aura

    // 3. Draw the Glass Surface (Specular highlights)
    _drawGlassHighlights(canvas, center, radius);
  }

  void _drawMorphingBlob(Canvas canvas, Offset center, double baseRadius, double opacity, double speed, double complexity) {
    final path = Path();
    const pointsCount = 60;
    
    // The "activity" increases with intensity
    final activity = intensity * 2.0 + 1.0;
    
    for (int i = 0; i <= pointsCount; i++) {
        final angle = (i / pointsCount) * 2 * math.pi;
        
        // Morphing logic
        double variance = 0.0;
        variance += math.sin(angle * 3 + time * 1.5 * speed) * 15 * activity;
        variance += math.cos(angle * 5 - time * 2.0 * speed) * 10 * activity;
        variance += math.sin(angle * complexity + time * 0.8) * 8;
        
        // Scale expansion with intensity
        final r = baseRadius + variance + (intensity * 20);
        
        final x = center.dx + r * math.cos(angle);
        final y = center.dy + r * math.sin(angle);
        
        if (i == 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
    }
    path.close();

    final blobPaint = Paint()
      ..color = baseColor.withOpacity((opacity + intensity * 0.2).clamp(0, 1))
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, 15 + intensity * 10);
    
    canvas.drawPath(path, blobPaint);
  }

  void _drawGlassHighlights(Canvas canvas, Offset center, double radius) {
    // Top highlight (Specular)
    final topHighlightPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Colors.white.withOpacity(0.4),
          Colors.white.withOpacity(0.0),
        ],
      ).createShader(Rect.fromCircle(center: center, radius: radius * 1.2));
    
    canvas.drawCircle(center, radius * 1.2, topHighlightPaint);

    // Subtle Rim
    final rimPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.white.withOpacity(0.5),
          Colors.white.withOpacity(0.1),
        ],
      ).createShader(Rect.fromCircle(center: center, radius: radius * 1.4));
    
    canvas.drawCircle(center, radius * 1.4, rimPaint);
  }

  @override
  bool shouldRepaint(covariant AiAuraPainter oldDelegate) => true;
}
