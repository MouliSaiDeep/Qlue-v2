import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
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
    bool reduceMotion = false;
    try {
      final appearance = context.watch<AppearanceProvider>();
      liquid = appearance.isLiquid;
      intensity = appearance.glassIntensity;
      reduceMotion = appearance.reduceMotion;
    } catch (_) {}

    final card = liquid
        ? _buildLiquid(t, intensity, reduceMotion)
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
  //
  // Real liquid glass from `liquid_glass_widgets` (the engine the nav bar
  // uses). `useOwnLayer: true` makes each card a standalone glass surface, so
  // it honors its own per-card tint/fill/blur/border with no layer ancestor.
  // Android/Impeller = full refractive shader; Windows/Skia/Web = frosted
  // BackdropFilter + specular rim (graceful degrade).
  Widget _buildLiquid(AppThemeColors t, double intensity, bool reduceMotion) {
    final double radius = borderRadius < 24 ? borderRadius + 6 : borderRadius;
    final Color glow = glowColor ?? t.primary;

    // Reuse the classic fill/tint tuning so text keeps contrast (readability
    // first — not maximally transparent).
    final Color tint = tintColor ?? (t.isDark ? Colors.white : Colors.black);
    final double fill =
        fillAlpha ?? (tintColor != null ? 0.15 : (t.isDark ? 0.08 : 0.05));
    final Color borderColor = hasMetallicBorder
        ? t.metallicBorder.withValues(alpha: 0.55)
        : tint.withValues(
            alpha: borderAlpha ??
                (tintColor != null ? 0.3 : (t.isDark ? 0.14 : 0.08)));

    final glass = lg.GlassContainer(
      useOwnLayer: true,
      quality:
          reduceMotion ? lg.GlassQuality.minimal : lg.GlassQuality.standard,
      glowIntensity: hasMetallicBorder ? 0.6 : 0.4,
      shape: lg.LiquidRoundedSuperellipse(
        borderRadius: radius,
        side: BorderSide(
          color: borderColor,
          width: hasMetallicBorder ? 1.2 : 1.0,
        ),
      ),
      settings: lg.LiquidGlassSettings(
        glassColor: tint.withValues(alpha: fill),
        bodyMode: tintColor != null
            ? lg.GlassBodyMode.clear
            : lg.GlassBodyMode.adaptive,
        blur: (blurSigma * 0.5 * intensity).clamp(2.0, 24.0).toDouble(),
        thickness: (18.0 * intensity).clamp(8.0, 40.0).toDouble(),
        refractiveIndex: 1.5,
        lightIntensity: 0.4,
        saturation: 1.1,
        glowIntensity: hasMetallicBorder ? 0.85 : 0.6,
      ),
      padding: padding,
      child: child,
    );
    // Outer shadow + optional colored glow. External BoxShadow is the faithful
    // match — the library's own shadow is light-mode only — and preserves the
    // grounded-float look the hand-rolled version had.
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
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.28),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: glass,
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
