import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
import '../core/theme.dart';
import '../context/appearance_provider.dart';

/// App-wide interactive controls with a dual Liquid/Classic path, mirroring
/// [GlassCard]. Under the Liquid appearance ([AppearanceProvider.isLiquid],
/// the default) each renders a real `liquid_glass_widgets` control; under
/// Classic it renders the app's normal Material / hand-rolled look. The public
/// APIs are appearance-agnostic so call sites never branch themselves.
///
/// Like [GlassCard] these pass `useOwnLayer: true`: the app has no
/// `AdaptiveLiquidGlassLayer` ancestor, so own-layer makes each control a
/// standalone glass surface that honours its own tint. The appearance read is
/// wrapped in a try/catch with liquid defaults so provider-less widget tests
/// keep working.

class _Appearance {
  final bool liquid;
  final double intensity;
  final bool reduceMotion;
  const _Appearance(this.liquid, this.intensity, this.reduceMotion);
}

_Appearance _readAppearance(BuildContext context) {
  try {
    final a = context.watch<AppearanceProvider>();
    return _Appearance(a.isLiquid, a.glassIntensity, a.reduceMotion);
  } catch (_) {
    return const _Appearance(true, 1.0, false);
  }
}

lg.GlassQuality _quality(bool reduceMotion) =>
    reduceMotion ? lg.GlassQuality.minimal : lg.GlassQuality.standard;

/// Visual weight for [AppButton].
enum AppButtonStyle { primary, secondary, danger }

/// A call-to-action button. Liquid -> [lg.GlassButton]; Classic -> the app's
/// gradient/filled rounded button. Pass either [label] (+ optional [icon]) or
/// a custom [child]. Disabled when [onTap] is null.
class AppButton extends StatelessWidget {
  final Widget? child;
  final String? label;
  final IconData? icon;
  final VoidCallback? onTap;
  final AppButtonStyle style;
  final double? width;
  final double height;
  final bool expand;
  final double borderRadius;
  final Color? color;
  final List<Color>? gradient;

  const AppButton({
    super.key,
    this.child,
    this.label,
    this.icon,
    required this.onTap,
    this.style = AppButtonStyle.primary,
    this.width,
    this.height = 54,
    this.expand = true,
    this.borderRadius = 16,
    this.color,
    this.gradient,
  }) : assert(child != null || label != null,
            'AppButton needs a child or a label');

  bool get _enabled => onTap != null;

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final a = _readAppearance(context);
    if (expand) {
      return LayoutBuilder(
        builder: (ctx, c) {
          final w = c.maxWidth.isFinite ? c.maxWidth : width;
          return a.liquid ? _buildLiquid(t, a, w) : _buildClassic(t, w);
        },
      );
    }
    return a.liquid ? _buildLiquid(t, a, width) : _buildClassic(t, width);
  }

  Color _accent(AppThemeColors t) {
    switch (style) {
      case AppButtonStyle.primary:
        return color ?? t.primary;
      case AppButtonStyle.secondary:
        return color ?? t.bgSecondary;
      case AppButtonStyle.danger:
        return color ?? t.error;
    }
  }

  Widget _content(AppThemeColors t) {
    if (child != null) return child!;
    final Color fg = style == AppButtonStyle.secondary ? t.text : Colors.white;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 18, color: fg),
          const SizedBox(width: 8),
        ],
        Text(
          label!,
          style: TextStyle(
            color: fg,
            fontSize: 15,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.3,
            fontFamily: 'Montserrat',
          ),
        ),
      ],
    );
  }

  Widget _buildLiquid(AppThemeColors t, _Appearance a, double? w) {
    final accent = _accent(t);
    return lg.GlassButton.custom(
      onTap: onTap ?? () {},
      enabled: _enabled,
      width: w,
      height: height,
      useOwnLayer: true,
      quality: _quality(a.reduceMotion),
      style: style == AppButtonStyle.primary
          ? lg.GlassButtonStyle.prominent
          : lg.GlassButtonStyle.filled,
      glowColor: accent,
      shape: lg.LiquidRoundedSuperellipse(borderRadius: borderRadius),
      settings: lg.LiquidGlassSettings(
        glassColor: accent.withValues(
            alpha: style == AppButtonStyle.secondary ? 0.22 : 0.5),
        bodyMode: lg.GlassBodyMode.clear,
        blur: (12.0 * a.intensity).clamp(2.0, 24.0),
        thickness: (16.0 * a.intensity).clamp(8.0, 40.0),
        refractiveIndex: 1.5,
        lightIntensity: 0.4,
        saturation: 1.1,
      ),
      child: Opacity(opacity: _enabled ? 1 : 0.6, child: _content(t)),
    );
  }

  Widget _buildClassic(AppThemeColors t, double? w) {
    final bool filled = style != AppButtonStyle.secondary;
    final accent = _accent(t);
    // Explicit gradient wins; an explicit solid `color` suppresses the default
    // gradient (so a plain green/blue CTA stays solid in Classic, not recolored
    // to the primary gradient). Otherwise fall back to per-style defaults.
    final List<Color>? grad = gradient ??
        (color != null
            ? null
            : style == AppButtonStyle.primary
                ? t.primaryGradient
                : style == AppButtonStyle.danger
                    ? [t.error, t.error.withValues(alpha: 0.85)]
                    : null);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Opacity(
        opacity: _enabled ? 1 : 0.6,
        child: Container(
          width: w,
          height: height,
          decoration: BoxDecoration(
            gradient: grad != null ? LinearGradient(colors: grad) : null,
            color: grad == null
                ? (filled ? accent : t.bgSecondary.withValues(alpha: 0.5))
                : null,
            borderRadius: BorderRadius.circular(borderRadius),
            border: Border.all(
              color: filled ? Colors.white.withValues(alpha: 0.25) : t.border,
              width: filled ? 0.8 : 1,
            ),
            boxShadow: filled
                ? [
                    BoxShadow(
                      color: accent.withValues(alpha: 0.3),
                      blurRadius: 15,
                      spreadRadius: 1,
                    ),
                  ]
                : null,
          ),
          child: Center(child: _content(t)),
        ),
      ),
    );
  }
}

/// A circular/rounded icon button. Liquid -> [lg.GlassIconButton]; Classic ->
/// a Material [IconButton], or a bordered circle when [background] is true
/// (matching the app's chrome back buttons).
class AppIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  final double size;
  final double iconSize;
  final Color? color;
  final String? tooltip;
  final bool background;
  final double? borderRadius;

  const AppIconButton({
    super.key,
    required this.icon,
    required this.onTap,
    this.size = 44,
    this.iconSize = 20,
    this.color,
    this.tooltip,
    this.background = false,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final a = _readAppearance(context);
    return a.liquid ? _buildLiquid(t, a) : _buildClassic(t);
  }

  Widget _buildLiquid(AppThemeColors t, _Appearance a) {
    final w = lg.GlassIconButton(
      onPressed: onTap,
      size: size,
      iconSize: iconSize,
      useOwnLayer: true,
      quality: _quality(a.reduceMotion),
      shape: borderRadius != null
          ? lg.GlassIconButtonShape.roundedSquare
          : lg.GlassIconButtonShape.circle,
      borderRadius: borderRadius ?? 12,
      glowColor: color ?? t.primary,
      icon: Icon(icon, size: iconSize, color: color ?? t.iconDefault),
    );
    return tooltip != null ? Tooltip(message: tooltip!, child: w) : w;
  }

  Widget _buildClassic(AppThemeColors t) {
    final ico = Icon(icon, size: iconSize, color: color ?? t.iconDefault);
    if (background) {
      return GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: borderRadius != null ? BoxShape.rectangle : BoxShape.circle,
            borderRadius:
                borderRadius != null ? BorderRadius.circular(borderRadius!) : null,
            color: t.bgSecondary.withValues(alpha: 0.5),
            border: Border.all(color: t.border, width: 1),
          ),
          child: Center(child: ico),
        ),
      );
    }
    return IconButton(
      onPressed: onTap,
      iconSize: iconSize,
      tooltip: tooltip,
      icon: ico,
      padding: EdgeInsets.zero,
      constraints: BoxConstraints.tightFor(width: size, height: size),
    );
  }
}

/// A selectable pill/chip. Liquid -> [lg.GlassChip]; Classic -> a rounded pill.
class AppChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final IconData? icon;
  final Color? selectedColor;

  const AppChip({
    super.key,
    required this.label,
    this.selected = false,
    this.onTap,
    this.icon,
    this.selectedColor,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final a = _readAppearance(context);
    return a.liquid ? _buildLiquid(t, a) : _buildClassic(t);
  }

  Widget _buildLiquid(AppThemeColors t, _Appearance a) {
    final accent = selectedColor ?? t.primary;
    return lg.GlassChip(
      label: label,
      selected: selected,
      onTap: onTap,
      selectedColor: accent,
      useOwnLayer: true,
      quality: _quality(a.reduceMotion),
      icon: icon != null
          ? Icon(icon, size: 16, color: selected ? accent : t.textSecondary)
          : null,
      labelStyle: TextStyle(
        color: selected ? t.text : t.textSecondary,
        fontSize: 13,
        fontWeight: FontWeight.w600,
        fontFamily: 'Montserrat',
      ),
    );
  }

  Widget _buildClassic(AppThemeColors t) {
    final accent = selectedColor ?? t.primary;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? accent.withValues(alpha: 0.15)
              : t.bgSecondary.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? accent : t.border, width: 1),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 16, color: selected ? accent : t.textSecondary),
              const SizedBox(width: 6),
            ],
            Text(
              label,
              style: TextStyle(
                color: selected ? t.text : t.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w600,
                fontFamily: 'Montserrat',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A horizontal value slider. Liquid -> [lg.GlassSlider]; Classic -> Material
/// [Slider].
class AppSlider extends StatelessWidget {
  final double value;
  final ValueChanged<double>? onChanged;
  final double min;
  final double max;
  final int? divisions;
  final Color? activeColor;
  final Color? inactiveColor;

  const AppSlider({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 0.0,
    this.max = 1.0,
    this.divisions,
    this.activeColor,
    this.inactiveColor,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final a = _readAppearance(context);
    final v = value.clamp(min, max);
    if (a.liquid) {
      return lg.GlassSlider(
        value: v,
        onChanged: onChanged,
        min: min,
        max: max,
        divisions: divisions,
        activeColor: activeColor ?? t.primary,
        inactiveColor: inactiveColor,
        useOwnLayer: true,
        quality: _quality(a.reduceMotion),
      );
    }
    return Slider(
      value: v,
      onChanged: onChanged,
      min: min,
      max: max,
      divisions: divisions,
      activeColor: activeColor ?? t.primary,
      inactiveColor: inactiveColor,
    );
  }
}

/// An on/off switch. Liquid -> [lg.GlassSwitch]; Classic -> Material [Switch].
class AppSwitch extends StatelessWidget {
  final bool value;
  final ValueChanged<bool>? onChanged;
  final Color? activeColor;

  const AppSwitch({
    super.key,
    required this.value,
    required this.onChanged,
    this.activeColor,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final a = _readAppearance(context);
    if (a.liquid) {
      return lg.GlassSwitch(
        value: value,
        onChanged: onChanged ?? (_) {},
        activeColor: activeColor ?? t.primary,
        useOwnLayer: true,
        quality: _quality(a.reduceMotion),
      );
    }
    return Switch(
      value: value,
      onChanged: onChanged,
      activeThumbColor: activeColor ?? t.primary,
    );
  }
}
