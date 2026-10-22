import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../context/appearance_provider.dart';
import '../../components/glass_controls.dart';

void showAppearancePreferences(BuildContext context) {
  final t = AppThemeColors.of(context);
  showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    useSafeArea: true,
    constraints: BoxConstraints(
      maxHeight: MediaQuery.sizeOf(context).height * .9,
    ),
    builder: (ctx) => Consumer<AppearanceProvider>(
      builder: (ctx, appearance, _) => SingleChildScrollView(
        child: Container(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 20,
            bottom: MediaQuery.of(ctx).padding.bottom + 24,
          ),
          decoration: BoxDecoration(
            color: t.bgSecondary,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            border: Border.all(color: t.metallicBorder.withValues(alpha: 0.2)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: t.textTertiary.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                "Appearance",
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  color: t.text,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                "Make Qlue yours — changes apply instantly everywhere.",
                style: TextStyle(fontSize: 12, color: t.textTertiary),
              ),
              const SizedBox(height: 20),
              Text(
                "GLASS STYLE",
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1,
                  color: t.textTertiary,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _styleChoice(
                      t,
                      "Liquid Glass",
                      "liquid",
                      appearance,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _styleChoice(t, "Classic", "classic", appearance),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Text(
                "GLASS INTENSITY",
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1,
                  color: t.textTertiary,
                ),
              ),
              AppSlider(
                value: appearance.glassIntensity,
                min: 0.6,
                max: 1.4,
                activeColor: t.primary,
                inactiveColor: t.metallicBorder.withValues(alpha: 0.3),
                onChanged: (v) => appearance.setGlassIntensity(v),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "Subtle",
                    style: TextStyle(fontSize: 11, color: t.textTertiary),
                  ),
                  Text(
                    "Heavy",
                    style: TextStyle(fontSize: 11, color: t.textTertiary),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Reduce motion",
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: t.text,
                          ),
                        ),
                        Text(
                          "Calms ambient animations, saves battery",
                          style: TextStyle(fontSize: 11, color: t.textTertiary),
                        ),
                      ],
                    ),
                  ),
                  AppSwitch(
                    value: appearance.reduceMotion,
                    activeColor: t.primary,
                    onChanged: (v) => appearance.setReduceMotion(v),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

Widget _styleChoice(
  AppThemeColors t,
  String label,
  String value,
  AppearanceProvider appearance,
) {
  final selected = appearance.glassStyle == value;
  return GestureDetector(
    onTap: () => appearance.setGlassStyle(value),
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: selected
            ? t.primary.withValues(alpha: 0.18)
            : t.bg.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: selected ? t.primary : t.metallicBorder.withValues(alpha: 0.3),
        ),
      ),
      child: Center(
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.bold,
            color: selected ? t.primary : t.textSecondary,
          ),
        ),
      ),
    ),
  );
}
