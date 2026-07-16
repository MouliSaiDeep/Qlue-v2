import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/theme.dart';
import '../context/appearance_provider.dart';

/// Glass surface used across the entire app.
///
/// Two user-selectable styles (Profile -> Appearance):
///  - 'liquid'  (default): iOS-26-style liquid glass — deep backdrop blur,
///    capsule-leaning radii, a bright specular top edge where light "enters"
///    the pane, a vertical sheen gradient, and soft grounded shadow.
///  - 'classic': the previous flat-glass rendering, byte-for-byte behavior.
///
/// The public API is unchanged, so every existing call site upgrades
/// automatically. Each card is isolated in a RepaintBoundary because
/// BackdropFilter is the most expensive widget in the app; this keeps
/// scrolling smooth even with many cards on screen.
class GlassCard extends StatelessWidget {
  final Widget child;
  final double borderRadius;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry margin;
  final double blurSigma;
  final double? fillAlpha;
  final double? borderAlpha;
  final Color? tintColor;
  final VoidCallback? onTap;
  final bool hasGlow;
  final Color? glowColor;
  final double glowRadius;
  final bool hasMetallicBorder;

  const GlassCard({
    super.key,
    required this.child,
    this.borderRadius = 20.0,
    this.padding = const EdgeInsets.all(16.0),
    this.margin = EdgeInsets.zero,
    this.blurSigma = 20.0,
    this.fillAlpha,
    this.borderAlpha,
    this.tintColor,
    this.onTap,
    this.hasGlow = false,
    this.glowColor,
    this.glowRadius = 40.0,
    this.hasMetallicBorder = false,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);

    // Appearance settings; safe defaults if the provider isn't registered
    // (e.g. widget tests).
    bool liquid = true;
    double intensity = 1.0;
    try {
      final appearance = context.watch<AppearanceProvider>();
      liquid = appearance.isLiquid;
      intensity = appearance.glassIntensity;
    } catch (_) {}

    final card = liquid
        ? _buildLiquid(t, intensity)
        : _buildClassic(t);

    final wrapped = RepaintBoundary(
      child: Padding(padding: margin, child: card),
    );

    if (onTap != null) {
      return GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: wrapped,
      );
    }
    return wrapped;
  }

  // ---------------------------------------------------------------- LIQUID
  Widget _buildLiquid(AppThemeColors t, double intensity) {
    // Liquid glass leans into rounder, capsule-like corners.
    final double radius = borderRadius < 24 ? borderRadius + 6 : borderRadius;
    final double sigma = blurSigma * 1.4 * intensity;
    final Color glow = glowColor ?? t.primary;

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        boxShadow: [
          if (hasGlow || glowColor != null)
            BoxShadow(
              color: glow.withValues(alpha: 0.16 * intensity),
              blurRadius: glowRadius,
              spreadRadius: 2,
            ),
          // Grounded depth: liquid panes float above the content.
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.28),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
          child: Stack(
            children: [
              // Body: vertical sheen — brighter where light enters at the top,
              // falling to near-clear at the bottom (see YT Music reference).
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(radius),
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.white.withValues(alpha: 0.115 * intensity),
                        Colors.white.withValues(alpha: 0.035),
                        (tintColor ?? Colors.white).withValues(alpha: 0.02),
                      ],
                      stops: const [0.0, 0.45, 1.0],
                    ),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.14 * intensity),
                      width: 1.0,
                    ),
                  ),
                ),
              ),
              // Specular top edge: the bright line where light refracts on the
              // pane's rim — the signature liquid-glass detail.
              Positioned(
                top: 0,
                left: radius * 0.6,
                right: radius * 0.6,
                child: Container(
                  height: 1.4,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        Colors.white.withValues(alpha: 0.0),
                        Colors.white.withValues(alpha: 0.55 * intensity),
                        Colors.white.withValues(alpha: 0.0),
                      ],
                    ),
                  ),
                ),
              ),
              // Soft corner bloom top-left: light pooling in the glass.
              Positioned(
                top: -30,
                left: -30,
                child: IgnorePointer(
                  child: Container(
                    width: 110,
                    height: 110,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: RadialGradient(
                        colors: [
                          Colors.white.withValues(alpha: 0.10 * intensity),
                          Colors.white.withValues(alpha: 0.0),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              Padding(padding: padding, child: child),
            ],
          ),
        ),
      ),
    );
  }

  // --------------------------------------------------------------- CLASSIC
  Widget _buildClassic(AppThemeColors t) {
    final Color defaultTint = t.isDark ? Colors.white : Colors.black;
    final Color effectiveTint = tintColor ?? defaultTint;
    final double activeFillAlpha =
        fillAlpha ?? (tintColor != null ? 0.15 : (t.isDark ? 0.05 : 0.02));
    final double activeBorderAlpha =
        borderAlpha ?? (tintColor != null ? 0.3 : (t.isDark ? 0.12 : 0.06));

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(borderRadius),
        boxShadow: [
          if (hasGlow || glowColor != null)
            BoxShadow(
              color: (glowColor ?? t.primary).withValues(alpha: 0.18),
              blurRadius: glowRadius,
              spreadRadius: 2,
            ),
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blurSigma, sigmaY: blurSigma),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: effectiveTint.withValues(alpha: activeFillAlpha),
              borderRadius: BorderRadius.circular(borderRadius),
              border: Border.all(
                color: hasMetallicBorder
                    ? t.metallicBorder.withValues(alpha: 0.5)
                    : effectiveTint.withValues(alpha: activeBorderAlpha),
                width: hasMetallicBorder ? 1.2 : 1.0,
              ),
              gradient: hasMetallicBorder
                  ? LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        Colors.white.withValues(alpha: 0.1),
                        Colors.transparent,
                        Colors.white.withValues(alpha: 0.05),
                      ],
                    )
                  : null,
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}
