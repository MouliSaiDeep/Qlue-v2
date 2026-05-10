import 'dart:math' as math;
import 'package:flutter/material.dart';

// FE-BUG #2 FIX: Replace bool isInwards with a proper enum so each phase has
// a distinct, named rendering mode instead of a binary flag.
// FE-BUG #9 FIX: Replace math.Random() per-frame (causes flicker) with
// deterministic math.sin() noise seeded by dot index + time.
enum DotMatrixMode {
  radiation,  // AI speaking — outward wave, green
  accretion,  // User listening — inward wave, orange
  random,     // Processing — deterministic sin-based noise, blue/purple
  glow,       // Connecting — pulsing brightness decay, off-white
}

class AiDotMatrixPainter extends CustomPainter {
  final double time;
  final double intensity;
  final Color baseColor;
  final DotMatrixMode mode;
  final Offset? tapOffset;
  final double tapTime;

  const AiDotMatrixPainter({
    required this.time,
    required this.intensity,
    required this.baseColor,
    required this.mode,
    this.tapOffset,
    this.tapTime = 0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final maxRadius = size.width / 2.5;
    final dotSpacing = 13.0;
    
    // 1. ATMOSPHERIC LIGHT LEAKS
    _drawSpectralGlow(canvas, center, maxRadius, baseColor, intensity);

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
          
          // BASE VOICE RIPPLE (mapped from DotMatrixMode)
          // Radiation (AI speaking) -> Outward wave (-5.0)
          // Accretion (User listening) -> Inward wave (5.0)
          final double waveSpeed = mode == DotMatrixMode.accretion ? 5.0 : 
                                   mode == DotMatrixMode.radiation ? -5.0 : 0.0;
                                   
          final double waveFrequency = 24.0;
          final double ripplePhase = (normDist * waveFrequency) + (time * waveSpeed);
          
          double state = 0.08 + 0.04 * math.sin(time + i * 0.2 + j * 0.1);
          
          if (intensity > 0.1 && waveSpeed != 0.0) {
             final double ripple = math.sin(ripplePhase);
             if (ripple > 0.2) {
                // Inward (accretion) fades out at edges, Outward (radiation) fades out at center
                final double decay = mode == DotMatrixMode.accretion ? 
                                     (0.2 + normDist * 0.8) : (1.0 - normDist * 0.7);
                state += (ripple + 1.0) * intensity * decay * 0.4;
             }
          }

          // Deterministic noise for random/processing mode (FE-BUG #9 FIX retained)
          if (intensity > 0.0 && mode == DotMatrixMode.random) { 
             final double noise = math.sin(i * 127.1 + time * 1.8) * math.sin(j * 311.7 + time * 2.3);
             state += (noise.abs() * 0.15); 
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
          dotPaint.color = baseColor.withValues(alpha: clampedState);
          
          final double r = 1.6 + 2.8 * (clampedState * clampedState);
          canvas.drawCircle(pos, r, dotPaint);

          if (clampedState > 0.8) {
             canvas.drawCircle(pos, r + 1, Paint()
               ..color = baseColor.withValues(alpha: clampedState * 0.2)
               ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3));
          }
       }
    }
  }

  void _drawSpectralGlow(Canvas canvas, Offset center, double radius, Color baseColor, double intensity) {
    final glowRadius = radius * (1.5 + intensity * 0.5);
    
    final gradient = RadialGradient(
      colors: [
        baseColor.withValues(alpha: 0.15 + intensity * 0.1),
        baseColor.withValues(alpha: 0.05),
        Colors.transparent,
      ],
      stops: const [0.2, 0.5, 1.0],
    );

    final rect = Rect.fromCircle(center: center, radius: glowRadius);
    final paint = Paint()
      ..shader = gradient.createShader(rect)
      ..blendMode = BlendMode.screen;

    canvas.drawCircle(center, glowRadius, paint);
  }

  @override
  bool shouldRepaint(covariant AiDotMatrixPainter oldDelegate) {
    return oldDelegate.time != time ||
        oldDelegate.intensity != intensity ||
        oldDelegate.mode != mode ||
        oldDelegate.baseColor != baseColor ||
        oldDelegate.tapOffset != tapOffset ||
        oldDelegate.tapTime != tapTime;
  }
}
