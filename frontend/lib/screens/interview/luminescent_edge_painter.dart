import 'dart:math' as math;
import 'package:flutter/material.dart';

class AiLuminescentEdgePainter extends CustomPainter {
  final double time;
  final double intensity; // Voice energy (0 to 1)
  final bool isUserSpeaking; // True = Emerald (User), False = Sapphire (AI)
  final Color baseColor;

  AiLuminescentEdgePainter({
    required this.time,
    required this.baseColor,
    this.intensity = 0.0,
    this.isUserSpeaking = false,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const double strokeWidth = 80.0;
    final Rect rect = Offset.zero & size;
    final double cornerRadius = 48.0;

    // 1. THE PERIMETER PATH
    final RRect rrect = RRect.fromRectAndRadius(rect, Radius.circular(cornerRadius));
    final Path path = Path()..addRRect(rrect);

    // 2. THE SPECTRAL GRADIENT
    // We create a "moving" light effect by oscillating the gradient stops or rotation
    final double rotation = time * 0.5;
    
    final Paint paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth * (1.0 + intensity * 0.5)
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, 20 + intensity * 30);

    // AI Speaking color is Sapphire, User is Emerald (matching app theme)
    final Color color1 = baseColor.withOpacity(0.4 + intensity * 0.4);
    final Color color2 = baseColor.withOpacity(0.1);
    final Color color3 = Colors.white.withOpacity(0.05 + intensity * 0.1);

    paint.shader = SweepGradient(
      center: Alignment.center,
      startAngle: rotation,
      endAngle: rotation + 2 * math.pi,
      colors: [color1, color2, color3, color2, color1],
      stops: const [0.0, 0.25, 0.5, 0.75, 1.0],
    ).createShader(rect);

    // 3. RENDER THE GOW
    // Use a clip to ensure the glow only "leaks" inward from the edge
    canvas.save();
    canvas.clipRRect(rrect); 
    // We draw with a thick stroke. Because we clipped to the RRect, 
    // half the stroke (the outward half) is hidden, and the inward half remains as an atmospheric glow.
    canvas.drawPath(path, paint);
    canvas.restore();

    // 4. SUBTLE ACCENT LINE (High-precision precision)
    final Paint accentPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0
      ..shader = SweepGradient(
        center: Alignment.center,
        startAngle: rotation,
        endAngle: rotation + 2 * math.pi,
        colors: [
           Colors.white.withOpacity(0.2 + intensity * 0.3),
           Colors.transparent,
           Colors.white.withOpacity(0.05),
           Colors.transparent,
           Colors.white.withOpacity(0.2),
        ],
      ).createShader(rect);
    
    canvas.drawRRect(rrect, accentPaint);
  }

  @override
  bool shouldRepaint(covariant AiLuminescentEdgePainter oldDelegate) => true;
}
