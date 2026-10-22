import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../../core/theme.dart';
import '../../../components/glass_card.dart';

class SettingRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color iconColor;
  final Color iconBg;
  final Widget? right;
  final VoidCallback? onPress;
  final bool destructive;

  const SettingRow({
    super.key,
    required this.icon,
    required this.label,
    required this.iconColor,
    required this.iconBg,
    this.right,
    this.onPress,
    this.destructive = false,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPress,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(child: Icon(icon, size: 15, color: iconColor)),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: destructive ? t.error : t.text,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              if (right != null)
                Flexible(
                  flex: 2,
                  child: Align(alignment: Alignment.centerRight, child: right!),
                )
              else if (onPress != null && !destructive)
                Icon(
                  FeatherIcons.chevronRight,
                  size: 16,
                  color: t.textTertiary,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class ProfileSection extends StatelessWidget {
  final String title;
  final Widget child;

  const ProfileSection({super.key, required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4.0, bottom: 8.0),
            child: Text(
              title,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.8,
                color: t.textTertiary,
              ),
            ),
          ),
          GlassCard(
            borderRadius: 18,
            padding: EdgeInsets.zero,
            hasMetallicBorder: true,
            child: child,
          ),
        ],
      ),
    );
  }
}

class ProfileDiv extends StatelessWidget {
  const ProfileDiv({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Container(
      height: 1,
      margin: const EdgeInsets.only(left: 62),
      color: t.borderSubtle,
    );
  }
}
