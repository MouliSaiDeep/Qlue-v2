import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
import '../core/theme.dart';
import '../context/appearance_provider.dart';

class SpectralInput extends StatelessWidget {
  final String label;
  final String hint;
  final IconData? icon;
  final bool obscureText;
  final ValueChanged<String>? onChanged;
  final Widget? suffix;
  final TextInputType keyboardType;

  const SpectralInput({
    super.key,
    required this.label,
    required this.hint,
    this.icon,
    this.obscureText = false,
    this.onChanged,
    this.suffix,
    this.keyboardType = TextInputType.text,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    bool liquid = true;
    bool reduceMotion = false;
    try {
      final a = context.watch<AppearanceProvider>();
      liquid = a.isLiquid;
      reduceMotion = a.reduceMotion;
    } catch (_) {}
    return liquid ? _buildLiquid(t, reduceMotion) : _buildClassic(t);
  }

  Widget _buildLiquid(AppThemeColors t, bool reduceMotion) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label.isNotEmpty) ...[
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: t.textSecondary,
              letterSpacing: 0.5,
              fontFamily: 'Montserrat',
            ),
          ),
          const SizedBox(height: 8),
        ],
        lg.GlassTextField(
          placeholder: hint,
          onChanged: onChanged,
          obscureText: obscureText,
          keyboardType: keyboardType,
          height: 56,
          useOwnLayer: true,
          quality: reduceMotion ? lg.GlassQuality.minimal : lg.GlassQuality.standard,
          glowColor: t.primary,
          shape: lg.LiquidRoundedSuperellipse(borderRadius: 16),
          prefixIcon: icon != null
              ? Icon(icon, size: 18, color: t.primary.withValues(alpha: 0.7))
              : null,
          suffixIcon: suffix,
          textStyle: TextStyle(color: t.text, fontSize: 15, fontFamily: 'Montserrat'),
          placeholderStyle: TextStyle(
            color: t.placeholder,
            fontSize: 15,
            fontWeight: FontWeight.w400,
          ),
        ),
      ],
    );
  }

  Widget _buildClassic(AppThemeColors t) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label.isNotEmpty) ...[
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: t.textSecondary,
              letterSpacing: 0.5,
              fontFamily: 'Montserrat',
            ),
          ),
          const SizedBox(height: 8),
        ],
        Container(
          height: 56,
          decoration: BoxDecoration(
            color: t.bgSecondary.withValues(alpha: 0.35),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: t.metallicBorder.withValues(alpha: 0.15),
              width: 1,
            ),
          ),
          child: Row(
            children: [
              if (icon != null) ...[
                const SizedBox(width: 16),
                Icon(icon, size: 18, color: t.primary.withValues(alpha: 0.7)),
              ],
              Expanded(
                child: TextField(
                  onChanged: onChanged,
                  obscureText: obscureText,
                  keyboardType: keyboardType,
                  style: TextStyle(
                    color: t.text,
                    fontSize: 15,
                    fontFamily: 'Montserrat',
                  ),
                  decoration: InputDecoration(
                    hintText: hint,
                    hintStyle: TextStyle(
                      color: t.placeholder,
                      fontSize: 15,
                      fontWeight: FontWeight.w400,
                    ),
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                  ),
                ),
              ),
              if (suffix != null) suffix as Widget,
            ],
          ),
        ),
      ],
    );
  }
}
