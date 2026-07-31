import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../core/theme.dart';
import 'sessions_screen.dart';
import 'ai_modules_screen.dart';
import 'history_screen.dart';
import '../../components/glass_card.dart';

class TabsScreen extends StatefulWidget {
  const TabsScreen({super.key});

  static void setIndex(BuildContext context, int index) {
    final state = context.findAncestorStateOfType<_TabsScreenState>();
    if (state != null) {
      state.updateIndex(index);
    }
  }

  @override
  State<TabsScreen> createState() => _TabsScreenState();
}

class _TabsScreenState extends State<TabsScreen> {
  int _currentIndex = 0;

  void updateIndex(int index) {
    setState(() => _currentIndex = index);
  }

  final List<Widget> _screens = const [
    SessionsScreen(),
    AIModulesScreen(),
    HistoryScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Scaffold(
      extendBody: true, // Allows body to flow underneath the transparent nav bar
      backgroundColor: t.bg,
      body: Stack(
        children: [
          IndexedStack(
            index: _currentIndex,
            children: _screens,
          ),
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
                      _buildNavItem(0, FeatherIcons.home, "Performance", t),
                      _buildNavItem(1, FeatherIcons.zap, "Practice", t),
                      _buildNavItem(2, FeatherIcons.clock, "Previous", t),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildNavItem(int index, IconData icon, String label, AppThemeColors t) {
    final isSelected = _currentIndex == index;
    
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutCubic,
        padding: EdgeInsets.symmetric(
          horizontal: isSelected ? 22 : 12,
          vertical: 12,
        ),
        decoration: BoxDecoration(
          color: isSelected ? t.primary.withOpacity(0.18) : Colors.transparent,
          borderRadius: BorderRadius.circular(30),
          border: isSelected ? Border.all(color: t.primary.withOpacity(0.4), width: 1) : null,
          boxShadow: isSelected ? [
            BoxShadow(
              color: t.primary.withOpacity(0.25),
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
              color: isSelected ? Colors.white : t.iconDefault.withOpacity(0.5),
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
