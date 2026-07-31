import 'package:flutter/material.dart';
import '../core/theme.dart';

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
            color: t.bgSecondary.withOpacity(0.35),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: t.metallicBorder.withOpacity(0.15),
              width: 1,
            ),
          ),
          child: Row(
            children: [
              if (icon != null) ...[
                const SizedBox(width: 16),
                Icon(icon, size: 18, color: t.primary.withOpacity(0.7)),
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
              if (suffix != null) suffix!,
            ],
          ),
        ),
      ],
    );
  }
}
