import 'dart:ui';
import 'package:flutter/material.dart';
import '../core/theme.dart';

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
    
    final Color defaultTint = t.isDark ? Colors.white : Colors.black; 
    final Color effectiveTint = tintColor ?? defaultTint;

    final double activeFillAlpha = fillAlpha ?? (tintColor != null ? 0.15 : (t.isDark ? 0.05 : 0.02));
    final double activeBorderAlpha = borderAlpha ?? (tintColor != null ? 0.3 : (t.isDark ? 0.12 : 0.06));

    final cardLayout = Padding(
      padding: margin,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(borderRadius),
          boxShadow: [
            if (hasGlow || glowColor != null)
              BoxShadow(
                color: (glowColor ?? t.primary).withOpacity(0.18),
                blurRadius: glowRadius,
                spreadRadius: 2,
                offset: const Offset(0, 0),
              ),
            BoxShadow(
              color: Colors.black.withOpacity(0.1),
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
                color: effectiveTint.withOpacity(activeFillAlpha),
                borderRadius: BorderRadius.circular(borderRadius),
                border: Border.all(
                  color: hasMetallicBorder 
                    ? t.metallicBorder.withOpacity(0.5) 
                    : effectiveTint.withOpacity(activeBorderAlpha),
                  width: hasMetallicBorder ? 1.2 : 1.0,
                ),
                gradient: hasMetallicBorder ? LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Colors.white.withOpacity(0.1),
                    Colors.transparent,
                    Colors.white.withOpacity(0.05),
                  ],
                ) : null,
              ),
              child: child,
            ),
          ),
        ),
      ),
    );

    if (onTap != null) {
      return GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: cardLayout,
      );
    }

    return cardLayout;
  }
}
