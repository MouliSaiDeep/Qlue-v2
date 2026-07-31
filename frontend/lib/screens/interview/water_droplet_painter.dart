import 'dart:math' as math;
import 'package:flutter/material.dart';

class AiWaterDropletPainter extends CustomPainter {
  final double time;
  final double intensity; // Voice energy (0 to 1)
  final Color baseColor;

  AiWaterDropletPainter({
    required this.time,
    required this.baseColor,
    this.intensity = 0.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final baseRadius = size.width / 3.8;

    // 1. GENERATE HIGH-DENSITY VISCOUS MESH
    final Path liquidPath = _getViscousMeshPath(center, baseRadius);

    // 2. THE CHROMIUM CORE (Deep Liquid Obsidian)
    _drawLiquidBody(canvas, center, baseRadius, liquidPath);

    // 3. INTERNAL MICRO-IMPERFECTIONS (Air Motes)
    _drawInternalMotes(canvas, center, baseRadius, liquidPath);

    // 4. SPECULAR BLOOM CLUSTER (Additive Highlights)
    _drawSpecularBloom(canvas, center, baseRadius);

    // 5. CAUSTICS & LIGHT POOLING
    _drawCaustics(canvas, center, baseRadius);
  }

  Path _getViscousMeshPath(Offset center, double radius) {
    const int vertexCount = 64; // High density for pixel-perfect curves
    final List<Offset> points = [];
    
    for (int i = 0; i < vertexCount; i++) {
      final double angle = (i / vertexCount) * 2 * math.pi;
      
      // Viscous physics: Low frequency sloshing + high frequency micro-ripples
      final double ripple = 
          math.sin(time * 1.5 + i * 0.4) * (2.0 + intensity * 6.0) +
          math.cos(time * 4.0 - i * 1.2) * (1.5 * intensity) +
          math.sin(time * 0.8 + i * 0.2) * 5.0; // Steady organic breathing
      
      final double r = radius + ripple;
      points.add(Offset(
        center.dx + r * math.cos(angle),
        center.dy + r * math.sin(angle),
      ));
    }

    final path = Path();
    path.moveTo(points[0].dx, points[0].dy);
    for (int i = 0; i < vertexCount; i++) {
      final p1 = points[i];
      final p2 = points[(i + 1) % vertexCount];
      final mid = Offset((p1.dx + p2.dx) / 2, (p1.dy + p2.dy) / 2);
      path.quadraticBezierTo(p1.dx, p1.dy, mid.dx, mid.dy);
    }
    path.close();
    return path;
  }

  void _drawLiquidBody(Canvas canvas, Offset center, double radius, Path path) {
    // LAYER 1: Deep Core Depth
    final corePaint = Paint()
      ..shader = RadialGradient(
        colors: [
          const Color(0xFF000000), 
          const Color(0xFF101010),
          const Color(0xFF1A1A1A),
        ],
        stops: const [0.0, 0.7, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius));
    canvas.drawPath(path, corePaint);

    // LAYER 2: Anisotropic Metallic Rim
    final rimPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..shader = SweepGradient(
        center: Alignment.center,
        colors: [
          Colors.white.withOpacity(0.4),
          Colors.white.withOpacity(0.0),
          Colors.white.withOpacity(0.7),
          Colors.white.withOpacity(0.1),
        ],
        stops: const [0.0, 0.4, 0.5, 1.0],
      ).createShader(Rect.fromCircle(center: center, radius: radius));
    
    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.rotate(time * 0.5);
    canvas.translate(-center.dx, -center.dy);
    canvas.drawPath(path, rimPaint..maskFilter = const MaskFilter.blur(BlurStyle.normal, 1.2));
    canvas.restore();
  }

  void _drawInternalMotes(Canvas canvas, Offset center, double radius, Path path) {
    canvas.save();
    canvas.clipPath(path);
    
    final random = math.Random(555);
    for (int i = 0; i < 30; i++) {
      final double x = (random.nextDouble() - 0.5) * radius * 1.8;
      final double y = (random.nextDouble() - 0.5) * radius * 1.8;
      final double bSpeed = 0.2 + random.nextDouble() * 0.4;
      
      final motePos = Offset(
        center.dx + x + math.sin(time * bSpeed + i) * 5,
        center.dy + y + math.cos(time * bSpeed * 1.2 - i) * 5,
      );

      canvas.drawCircle(motePos, 0.5 + random.nextDouble() * 1.5, Paint()..color = Colors.white.withOpacity(0.02 + random.nextDouble() * 0.08));
    }
    canvas.restore();
  }

  void _drawSpecularBloom(Canvas canvas, Offset center, double radius) {
    // Additive Bloom Effect using saveLayer and screen blend mode
    canvas.saveLayer(Rect.fromCircle(center: center, radius: radius * 1.5), Paint()..blendMode = BlendMode.screen);

    // Primary High-intensity Glint Cluster
    _drawGlint(canvas, center, radius, -0.4, -0.55, 0.35, 0.7); // Main top
    _drawGlint(canvas, center, radius, -0.5, -0.35, 0.15, 0.4); // Side support
    _drawGlint(canvas, center, radius, 0.35, -0.4, 0.1, 0.3); // Accent glint

    canvas.restore();
  }

  void _drawGlint(Canvas canvas, Offset center, double radius, double ox, double oy, double scale, double opacity) {
    final pos = Offset(center.dx + radius * ox, center.dy + radius * oy);
    
    // Radiant Bloom
    final bloomPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          Colors.white.withOpacity(opacity + intensity * 0.2),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: pos, radius: radius * scale));
    
    canvas.drawCircle(pos, radius * scale, bloomPaint..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8));
    
    // Photographic Hot-spot
    canvas.drawCircle(pos, radius * scale * 0.2, Paint()..color = Colors.white.withOpacity(0.9));
  }

  void _drawCaustics(Canvas canvas, Offset center, double radius) {
    final causticPos = Offset(center.dx, center.dy + radius * 0.7);
    final causticPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          Colors.white.withOpacity(0.12 + intensity * 0.1),
          Colors.transparent,
        ],
      ).createShader(Rect.fromCircle(center: causticPos, radius: radius * 0.4));
    
    canvas.drawCircle(causticPos, radius * 0.45, causticPaint..maskFilter = const MaskFilter.blur(BlurStyle.normal, 20));
  }

  @override
  bool shouldRepaint(covariant AiWaterDropletPainter oldDelegate) => true;
}
