import 'dart:math';
import 'package:flutter/material.dart';

/// A 3D sphere of ~450 particles projected onto a 2D canvas, ported from an
/// earlier version of Qlue. The sphere follows the AI's conversational state:
///   - speaking  -> [moduleColor] (the selected module's accent color)
///   - listening -> off-white
///   - idle      -> off-white particles, no aura glow
/// Set [animate] to false (reduce-motion) to render a static sphere.
class Particle {
  double x, y, z;
  double targetX, targetY, targetZ;
  double velocityX = 0, velocityY = 0, velocityZ = 0;
  double baseSize;
  double pulseOffset;
  double pulseSpeed;

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
  final Color color;

  ParticleSpherePainter({
    required this.particles,
    required this.rotation,
    required this.isSpeaking,
    required this.time,
    required this.color,
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
    }).toList()
      ..sort((a, b) => a.rz.compareTo(b.rz));

    for (var rp in rotatedParticles) {
      final p = rp.particle;
      final scale = 300 / (300 + rp.rz);
      final x2d = centerX + rp.rx * scale;
      final y2d = centerY + rp.ry * scale;

      final distortionAmount = isSpeaking ? 5.0 : 0.0;
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
      final alpha = (isSpeaking ? min(1.0, baseAlpha * 1.3) : baseAlpha)
          .clamp(0.0, 1.0);

      final paint = Paint()..color = color.withValues(alpha: alpha);
      canvas.drawCircle(Offset(finalX, finalY), particleSize, paint);
    }
  }

  @override
  bool shouldRepaint(ParticleSpherePainter oldDelegate) => true;
}

class ParticleSphere extends StatefulWidget {
  /// Accent color of the selected module; used while the AI speaks.
  final Color moduleColor;
  final bool isSpeaking;
  final bool isListening;

  /// When false the sphere renders statically (respects reduce-motion).
  final bool animate;

  const ParticleSphere({
    super.key,
    required this.moduleColor,
    this.isSpeaking = false,
    this.isListening = false,
    this.animate = true,
  });

  @override
  State<ParticleSphere> createState() => _ParticleSphereState();
}

class _ParticleSphereState extends State<ParticleSphere>
    with SingleTickerProviderStateMixin {
  /// Soft off-white used while listening / idle.
  static const Color _offWhite = Color(0xFFF5F5F0);

  late AnimationController _animationController;
  final List<Particle> _particles = [];
  Offset _rotation = const Offset(0, 0);
  Offset? _lastDragPosition;
  double _time = 0;

  @override
  void initState() {
    super.initState();
    _initParticles();
    _animationController =
        AnimationController(vsync: this, duration: const Duration(days: 1))
          ..addListener(() {
            if (!mounted) return;
            setState(() {
              _time += 0.016;
              _updateParticles();
              if (_lastDragPosition == null) {
                _rotation = Offset(_rotation.dx, _rotation.dy + 0.002);
              }
            });
          });
    // Freeze the loop when reduce-motion is on; the sphere still paints once.
    if (widget.animate) {
      _animationController.repeat();
    }
  }

  void _initParticles() {
    const int numParticles = 450;
    const double radius = 90;
    final random = Random();
    for (int i = 0; i < numParticles; i++) {
      final phi = acos(1 - 2 * (i + 0.5) / numParticles);
      final theta = pi * (1 + sqrt(5)) * i;
      final x = radius * sin(phi) * cos(theta);
      final y = radius * sin(phi) * sin(theta);
      final z = radius * cos(phi);
      _particles.add(
        Particle(
          x: x,
          y: y,
          z: z,
          targetX: x,
          targetY: y,
          targetZ: z,
          baseSize: random.nextDouble() * 1.2 + 0.8,
          pulseOffset: random.nextDouble() * pi * 2,
          pulseSpeed: 0.8 + random.nextDouble() * 0.4,
        ),
      );
    }
  }

  void _updateParticles() {
    const springForce = 0.02;
    const damping = 0.85;
    for (var p in _particles) {
      final dx = p.targetX - p.x;
      final dy = p.targetY - p.y;
      final dz = p.targetZ - p.z;
      p.velocityX += dx * springForce;
      p.velocityY += dy * springForce;
      p.velocityZ += dz * springForce;
      p.velocityX *= damping;
      p.velocityY *= damping;
      p.velocityZ *= damping;
      p.x += p.velocityX;
      p.y += p.velocityY;
      p.z += p.velocityZ;
    }
  }

  RotatedParticle _rotateParticle(Particle p) {
    final cosX = cos(_rotation.dx);
    final sinX = sin(_rotation.dx);
    final cosY = cos(_rotation.dy);
    final sinY = sin(_rotation.dy);
    final y1 = p.y * cosX - p.z * sinX;
    final z1 = p.y * sinX + p.z * cosX;
    final x1 = p.x * cosY + z1 * sinY;
    final z2 = -p.x * sinY + z1 * cosY;
    return RotatedParticle(rx: x1, ry: y1, rz: z2, particle: p);
  }

  void _scatterParticles(Offset position, Size size) {
    final centerX = size.width / 2;
    final centerY = size.height / 2;
    const scatterRadius = 100.0;
    for (var p in _particles) {
      final rotated = _rotateParticle(p);
      final scale = 300 / (300 + rotated.rz);
      final x2d = centerX + rotated.rx * scale;
      final y2d = centerY + rotated.ry * scale;
      final dx = x2d - position.dx;
      final dy = y2d - position.dy;
      final dist = sqrt(dx * dx + dy * dy);
      if (dist < scatterRadius) {
        final force = (scatterRadius - dist) / scatterRadius;
        final angle = atan2(dy, dx);
        final scatterDist = 60 * force;
        p.x += cos(angle) * scatterDist;
        p.y += sin(angle) * scatterDist;
        p.z += (Random().nextDouble() - 0.5) * scatterDist;
      }
    }
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  /// Particle/aura color for the current state.
  Color get _activeColor {
    if (widget.isSpeaking) return widget.moduleColor;
    return _offWhite; // listening + idle
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;

    Color auraColor = Colors.transparent;
    if (widget.isSpeaking) {
      auraColor = widget.moduleColor.withValues(alpha: 0.6);
    } else if (widget.isListening) {
      auraColor = _offWhite.withValues(alpha: 0.5);
    }

    return Stack(
      alignment: Alignment.center,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 600),
          curve: Curves.easeInOut,
          width: 200,
          height: 200,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: auraColor,
                blurRadius: 120,
                spreadRadius: 30,
              ),
            ],
          ),
        ),
        GestureDetector(
          onPanStart: (details) {
            _lastDragPosition = details.localPosition;
            _scatterParticles(details.localPosition, size);
          },
          onPanUpdate: (details) {
            _scatterParticles(details.localPosition, size);
            if (_lastDragPosition != null) {
              final delta = details.localPosition - _lastDragPosition!;
              setState(() {
                _rotation = Offset(
                  _rotation.dx + delta.dy * 0.005,
                  _rotation.dy + delta.dx * 0.005,
                );
              });
            }
            _lastDragPosition = details.localPosition;
          },
          onPanEnd: (_) => _lastDragPosition = null,
          behavior: HitTestBehavior.translucent,
          child: CustomPaint(
            size: Size.infinite,
            painter: ParticleSpherePainter(
              particles: _particles,
              rotation: _rotation,
              isSpeaking: widget.isSpeaking || widget.isListening,
              time: _time,
              color: _activeColor,
            ),
          ),
        ),
      ],
    );
  }
}
