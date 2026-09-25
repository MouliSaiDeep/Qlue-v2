
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
import '../../core/theme.dart';
import '../../context/dashboard_provider.dart';

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

class _TabsScreenState extends State<TabsScreen> with WidgetsBindingObserver {
  // REALTIME REFRESH: which tab currently drives the auto-refresh loop.
  // Tabs 0 (Performance) and 2 (Previous) display dashboard data.
  int? _lastManagedIndex;

  static bool _isDataTab(int index) => index == 0 || index == 2;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // Stop polling when the tab shell leaves the tree (e.g. logout).
    context.read<DashboardProvider>().stopAutoRefresh();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final dashboard = context.read<DashboardProvider>();
    if (state == AppLifecycleState.resumed) {
      if (_isDataTab(TabsScreen.currentIndex)) {
        dashboard.refreshNow(); // catch up instantly on return
        dashboard.startAutoRefresh();
      }
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      // No polling in the background: saves battery and AWS requests.
      dashboard.stopAutoRefresh();
    }
  }

  void _manageAutoRefresh(int index) {
    if (_lastManagedIndex == index) return;
    _lastManagedIndex = index;
    final dashboard = context.read<DashboardProvider>();
    if (_isDataTab(index)) {
      dashboard.refreshNow(); // instant update the moment a data tab opens
      dashboard.startAutoRefresh();
    } else {
      dashboard.stopAutoRefresh();
    }
  }

  int _calculateIndex(String location) {
    int newIndex = 0;
    if (location.startsWith('/dashboard')) {
      newIndex = 0;
    } else if (location.startsWith('/practice')) {
      newIndex = 1;
    } else if (location.startsWith('/history')) {
      newIndex = 2;
    }
    
    TabsScreen.currentIndex = newIndex;
    return newIndex;
  }


  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final int currentIndex = _calculateIndex(location);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _manageAutoRefresh(currentIndex);
    });
    final t = AppThemeColors.of(context);
    return Scaffold(
      extendBody: true, // Allows body to flow underneath the transparent nav bar
      backgroundColor: t.bg,
      body: Stack(
        children: [
          widget.child,
          // Floating liquid-glass tab bar. Hidden while the keyboard is open so
          // it never sits on top of a focused text field.
          if (MediaQuery.of(context).viewInsets.bottom == 0)
            Align(
              alignment: Alignment.bottomCenter,
              child: SafeArea(
                top: false,
                child: RepaintBoundary(
                  // GlassTabBar.bottom draws the whole capsule: the frosted
                  // liquid-glass track, the sliding jelly/gooey selection lens
                  // (spring settle + concave-lens pinch + jelly-bloom expansion),
                  // and icon-above-label items whose labels stay visible. It
                  // supplies its own side/bottom margins, so it needs the full
                  // screen width and no outer padding.
                  child: lg.GlassTabBar.bottom(
                    tabs: const [
                      lg.GlassTab(
                          icon: Icon(FeatherIcons.home), label: 'Performance'),
                      lg.GlassTab(
                          icon: Icon(FeatherIcons.zap), label: 'Practice'),
                      lg.GlassTab(
                          icon: Icon(FeatherIcons.clock), label: 'Previous'),
                    ],
                    selectedIndex: currentIndex,
                    onTabSelected: (index) {
                      TabsScreen.lastIndex = currentIndex;
                      TabsScreen.setIndex(context, index);
                    },
                    // Active tab rides a green accent glass lens with white
                    // glyphs. Plain green-on-frosted-glass washed out against
                    // the light indicator, so the pill itself carries the accent
                    // and the icon+label stay crisp white on top of it.
                    indicatorColor: t.primary.withValues(alpha: 0.8),
                    selectedIconColor: Colors.white,
                    selectedLabelColor: Colors.white,
                    unselectedIconColor: t.iconDefault,
                    unselectedLabelColor: t.textTertiary,
                    // Near-transparent dark glass — a high tint reads as a milky
                    // slab instead of see-through glass, especially on the
                    // Skia/Windows fallback path.
                    settings: lg.LiquidGlassSettings(
                      thickness: 24,
                      blur: 4,
                      glassColor: Colors.white
                          .withValues(alpha: t.isDark ? 0.06 : 0.10),
                      lightIntensity: 0.4,
                      refractiveIndex: 1.5,
                      saturation: 1.1,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
