
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme.dart';
import '../../components/glass_card.dart';

class TabsScreen extends StatefulWidget {
  final Widget child;
  static int lastIndex = 0;
  static int currentIndex = 0;
  
  const TabsScreen({super.key, required this.child});

  static void setIndex(BuildContext context, int index) {
    TabsScreen.lastIndex = TabsScreen.currentIndex;
    switch (index) {
      case 0: context.go('/dashboard'); break;
      case 1: context.go('/practice'); break;
      case 2: context.go('/history'); break;
    }
  }

  @override
  State<TabsScreen> createState() => _TabsScreenState();
}

class _TabsScreenState extends State<TabsScreen> {

  int _calculateIndex(String location) {
    int newIndex = 0;
    if (location.startsWith('/dashboard')) newIndex = 0;
    else if (location.startsWith('/practice')) newIndex = 1;
    else if (location.startsWith('/history')) newIndex = 2;
    
    TabsScreen.currentIndex = newIndex;
    return newIndex;
  }


  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final int currentIndex = _calculateIndex(location);
    final t = AppThemeColors.of(context);
    return Scaffold(
      extendBody: true, // Allows body to flow underneath the transparent nav bar
      backgroundColor: t.bg,
      body: Stack(
        children: [
          widget.child,
          if (MediaQuery.of(context).viewInsets.bottom == 0)
            Align(
              alignment: Alignment.bottomCenter,
              child: GlassCard(
                margin: const EdgeInsets.only(bottom: 30, left: 24, right: 24),
                borderRadius: 40,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
                hasGlow: true,
                glowColor: t.primary,
                glowRadius: 50,
                blurSigma: 30,
                hasMetallicBorder: true,
                child: SizedBox(
                  height: 72,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _buildNavItem(0, FeatherIcons.home, "Performance", t, currentIndex),
                      _buildNavItem(1, FeatherIcons.zap, "Practice", t, currentIndex),
                      _buildNavItem(2, FeatherIcons.clock, "Previous", t, currentIndex),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildNavItem(int index, IconData icon, String label, AppThemeColors t, int currentIndex) {
    final isSelected = currentIndex == index;
    
    return GestureDetector(
      onTap: () {
        TabsScreen.lastIndex = currentIndex;
        TabsScreen.setIndex(context, index);
      },
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
        padding: EdgeInsets.symmetric(
          horizontal: isSelected ? 22 : 12,
          vertical: 12,
        ),
        decoration: BoxDecoration(
          color: isSelected ? t.primary.withValues(alpha: 0.18) : Colors.transparent,
          borderRadius: BorderRadius.circular(30),
          border: isSelected ? Border.all(color: t.primary.withValues(alpha: 0.4), width: 1) : null,
          boxShadow: isSelected ? [
            BoxShadow(
              color: t.primary.withValues(alpha: 0.25),
              blurRadius: 15,
              spreadRadius: 1,
            )
          ] : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              color: isSelected ? Colors.white : t.iconDefault.withValues(alpha: 0.5),
              size: 22,
            ),
            if (isSelected) ...[
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 14,
                  letterSpacing: 0.2,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
