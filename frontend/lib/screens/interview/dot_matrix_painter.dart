import 'dart:math' as math;
import 'package:flutter/material.dart';

class AiDotMatrixPainter extends CustomPainter {
  final double time;
  final double intensity; // Voice intensity (0 to 1)
  final bool isInwards; // True = Accretion (User), False = Radiation (AI)
  final Color baseColor;
  
  // Interaction Data
  final Offset? tapOffset;
  final double tapTime;

  AiDotMatrixPainter({
    required this.time,
    required this.baseColor,
    this.intensity = 0.0,
    this.isInwards = false,
    this.tapOffset,
    this.tapTime = 0.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final maxRadius = size.width / 2.5;
    final dotSpacing = 13.0;
    
    // 1. ATMOSPHERIC LIGHT LEAKS
    _drawSpectralGlow(canvas, center, maxRadius);

    // 2. THE DOT CORE ENGINE
    final Paint dotPaint = Paint()..style = PaintingStyle.fill;
    
    final int cols = (size.width / dotSpacing).floor();
    final int rows = (size.height / dotSpacing).floor();

    for (int i = 0; i < cols; i++) {
       for (int j = 0; j < rows; j++) {
          final double x = i * dotSpacing + (dotSpacing / 2);
          final double y = j * dotSpacing + (dotSpacing / 2);
          final Offset pos = Offset(x, y);
          
          final double distFromCenter = (pos - center).distance;
          if (distFromCenter > maxRadius) continue;

          final double normDist = distFromCenter / maxRadius;
          
          // BASE VOICE RIPPLE
          final double waveSpeed = isInwards ? 5.0 : -5.0;
          final double waveFrequency = 24.0;
          final double ripplePhase = (normDist * waveFrequency) + (time * waveSpeed);
          
          double state = 0.08 + 0.04 * math.sin(time + i * 0.2 + j * 0.1);
          
          if (intensity > 0.1) {
             final double ripple = math.sin(ripplePhase);
             if (ripple > 0.2) {
                final double decay = isInwards ? (0.2 + normDist * 0.8) : (1.0 - normDist * 0.7);
                state += (ripple + 1.0) * intensity * decay * 0.4;
             }
          }

          // INTERACTIVE TAP RIPPLE - Snappy Hardware Response
          if (tapOffset != null) {
             final double duration = 0.8; // Shorter, more professional burst
             final double timeSinceTap = time - tapTime;
             
             if (timeSinceTap > 0 && timeSinceTap < duration) {
                final double distFromTap = (pos - tapOffset!).distance;
                // High-velocity ripple expansion
                final double tapRipplePhase = (distFromTap / 20.0) - (timeSinceTap * 15.0);
                final double tapWave = math.sin(tapRipplePhase * math.pi);
                
                if (tapWave > 0.4) {
                   final double tapFade = (1.0 - timeSinceTap / duration).clamp(0.0, 1.0);
                   state += tapWave * tapFade * 0.7;
                }
             }
          }

          // Central "Sink/Source" Glow
          final double coreGlow = math.pow(1.0 - normDist, 3).toDouble();
          state += coreGlow * (intensity * 0.5);

          final double clampedState = state.clamp(0.02, 1.0);
          dotPaint.color = baseColor.withOpacity(clampedState);
          
          final double r = 1.6 + 2.8 * (clampedState * clampedState);
          canvas.drawCircle(pos, r, dotPaint);

          if (clampedState > 0.8) {
             canvas.drawCircle(pos, r + 1, Paint()
               ..color = baseColor.withOpacity(clampedState * 0.2)
               ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3));
          }
       }
    }
  }

  void _drawSpectralGlow(Canvas canvas, Offset center, double radius) {
    final glowPaint = Paint()
      ..shader = RadialGradient(
        colors: [
           baseColor.withOpacity(0.1 + intensity * 0.1),
           baseColor.withOpacity(0.0),
        ],
        stops: const [0.4, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius * 1.5));
    
    canvas.drawCircle(center, radius * 1.5, glowPaint..maskFilter = const MaskFilter.blur(BlurStyle.normal, 40));
  }

  @override
  bool shouldRepaint(covariant AiDotMatrixPainter oldDelegate) => true;
}
