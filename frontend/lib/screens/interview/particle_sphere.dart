import 'dart:math';
import 'package:flutter/material.dart';

class Particle {
  double x, y, z;
  double targetX, targetY, targetZ;
  double velocityX = 0, velocityY = 0, velocityZ = 0;
  double baseSize;
  double pulseOffset;
  double pulseSpeed;
  bool scattered = false;
  double scatterTime = 0;

  Particle({
    required this.x,
    required this.y,
    required this.z,
    required this.targetX,
    required this.targetY,
    required this.targetZ,
    required this.baseSize,
    required this.pulseOffset,
    required this.pulseSpeed,
  });
}

class RotatedParticle {
  final double rx, ry, rz;
  final Particle particle;

  RotatedParticle({
    required this.rx,
    required this.ry,
    required this.rz,
    required this.particle,
  });
}

class ParticleSpherePainter extends CustomPainter {
  final List<Particle> particles;
  final Offset rotation;
  final bool isSpeaking;
  final double time;

  ParticleSpherePainter({
    required this.particles,
    required this.rotation,
    required this.isSpeaking,
    required this.time,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final centerX = size.width / 2;
    final centerY = size.height / 2;
    const radius = 120.0;

    final rotatedParticles = particles.map((p) {
      final cosX = cos(rotation.dx);
      final sinX = sin(rotation.dx);
      final cosY = cos(rotation.dy);
      final sinY = sin(rotation.dy);
      final y1 = p.y * cosX - p.z * sinX;
      final z1 = p.y * sinX + p.z * cosX;
      final x1 = p.x * cosY + z1 * sinY;
      final z2 = -p.x * sinY + z1 * cosY;
      return RotatedParticle(rx: x1, ry: y1, rz: z2, particle: p);
    }).toList()..sort((a, b) => a.rz.compareTo(b.rz));

    for (var rp in rotatedParticles) {
      final p = rp.particle;
      final scale = 300 / (300 + rp.rz);
      final x2d = centerX + rp.rx * scale;
      final y2d = centerY + rp.ry * scale;

      final double distortionAmount = isSpeaking ? 5.0 : 0.0;
      final distortionX = sin(p.x * 0.1 + time * 6) * distortionAmount;
      final distortionY = cos(p.y * 0.1 + time * 6) * distortionAmount;
      final finalX = x2d + distortionX;
      final finalY = y2d + distortionY;

      final speakingPulse = isSpeaking
          ? sin(time * 8 + p.pulseOffset) * 0.4 + 1.0
          : sin(time * p.pulseSpeed + p.pulseOffset) * 0.15 + 0.85;

      final particleSize = p.baseSize * scale * speakingPulse;
      final brightness = (rp.rz + radius) / (radius * 2);
      final baseAlpha = 0.4 + brightness * 0.6;
      final alpha = (isSpeaking ? min(1.0, baseAlpha * 1.3) : baseAlpha).clamp(0.0, 1.0);

      final paint = Paint()..color = Colors.white.withOpacity(alpha);

      canvas.drawCircle(Offset(finalX, finalY), particleSize, paint);
    }
  }

  @override
  bool shouldRepaint(ParticleSpherePainter oldDelegate) => true;
}
