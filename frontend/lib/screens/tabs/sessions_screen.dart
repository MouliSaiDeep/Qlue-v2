import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../core/theme.dart';
import '../../core/mock_data.dart';
import 'tabs_screen.dart';
import '../../components/glass_card.dart';
import '../../components/spider_chart.dart';
import '../../components/premium_flip_card.dart';
import '../../components/spectral_background.dart';
import '../../components/avatar.dart';
import '../../context/auth_provider.dart';
import 'profile_screen.dart';

class SessionsScreen extends StatefulWidget {
  const SessionsScreen({super.key});
  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen>
    with TickerProviderStateMixin {
  List<Session> sessions = List.from(mockSessions);
  String _selectedRadar = "overall";
  late AnimationController _flipEffectController;

  @override
  void initState() {
    super.initState();
    _flipEffectController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
  }

  @override
  void dispose() {
    _flipEffectController.dispose();
    super.dispose();
  }

  String _getGreetingText() {
    final hour = DateTime.now().hour;
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final topPadding = MediaQuery.of(context).padding.top;
    final bottomPadding = MediaQuery.of(context).padding.bottom;

    final total = sessions.length;
    final avgScore = total > 0
        ? (sessions.fold(0, (sum, s) => sum + s.score) / total).round()
        : 0;

    // Stats for 2x2 grid
    Map<String, int> byModule = {
      "resume": 0,
      "hr": 0,
      "website": 0,
      "intro": 0,
    };
    for (var s in sessions) {
      if (byModule.containsKey(s.module))
        byModule[s.module] = byModule[s.module]! + 1;
    }

    final auth = Provider.of<AuthProvider>(context);

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: CustomScrollView(
          slivers: [
            // APP BAR / HEADER
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.only(
                  top: topPadding + 16,
                  bottom: 24,
                  left: 24,
                  right: 24,
                ),
                child: Row(
                  children: [
                    GestureDetector(
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfileScreen())),
                      child: Avatar(
                        imageUrl: auth.profileImageUrl,
                        size: 44,
                        isCircle: true,
                        border: Border.all(color: t.metallicBorder.withOpacity(0.5), width: 1.5),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _getGreetingText(),
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: t.textTertiary,
                              letterSpacing: 1.0,
                            ),
                          ),
                          Text(
                            auth.displayName,
                            style: TextStyle(
                              fontSize: 20,
                              color: t.text,
                              fontWeight: FontWeight.w900,
                              letterSpacing: -0.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // OVERALL PERFORMANCE & MINI STATS
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: SizedBox(
                  height: 125,
                  child: Row(
                    children: [
                      Expanded(child: _buildScoreDisplay(t, avgScore)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _buildMiniStatCard(
                          t,
                          "Accuracy",
                          "82%",
                          FeatherIcons.target,
                          t.accentGreen,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // 2x2 MODULE GRID
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 14, left: 24, right: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildSectionTitle(t, "Modules Overview"),
                    const SizedBox(height: 0),
                    GridView.count(
                      padding: const EdgeInsets.only(top: 14, bottom: 14),
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      crossAxisCount: 2,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 1.6,
                      children: [
                        PremiumFlipCard(
                          onFlip: (isFront) => isFront
                              ? _flipEffectController.reverse()
                              : _flipEffectController.forward(),
                          front: _buildModuleTile(
                            t,
                            "Resume",
                            "${byModule['resume']} Sessions",
                            FeatherIcons.fileText,
                            t.moduleResume,
                          ),
                          back: _buildModuleStats(t, "Resume", "High: 92%"),
                        ),
                        PremiumFlipCard(
                          onFlip: (isFront) => isFront
                              ? _flipEffectController.reverse()
                              : _flipEffectController.forward(),
                          front: _buildModuleTile(
                            t,
                            "HR",
                            "${byModule['hr']} Sessions",
                            FeatherIcons.users,
                            t.moduleHR,
                          ),
                          back: _buildModuleStats(t, "HR", "High: 88%"),
                        ),
                        PremiumFlipCard(
                          onFlip: (isFront) => isFront
                              ? _flipEffectController.reverse()
                              : _flipEffectController.forward(),
                          front: _buildModuleTile(
                            t,
                            "Website",
                            "${byModule['website']} Sessions",
                            FeatherIcons.globe,
                            t.moduleWeb,
                          ),
                          back: _buildModuleStats(t, "Website", "High: 85%"),
                        ),
                        PremiumFlipCard(
                          onFlip: (isFront) => isFront
                              ? _flipEffectController.reverse()
                              : _flipEffectController.forward(),
                          front: _buildModuleTile(
                            t,
                            "Intro",
                            "${byModule['intro']} Sessions",
                            FeatherIcons.mic,
                            t.accentGreen,
                          ),
                          back: _buildModuleStats(t, "Intro", "High: 90%"),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            // PERFORMANCE RADAR WITH DROPDOWN
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 4, left: 24, right: 24),
                child: GlassCard(
                  hasMetallicBorder: true,
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          _buildSectionTitle(t, "Performance Radar"),
                          _buildRadarDropdown(t),
                        ],
                      ),
                      const SizedBox(height: 20),
                      Center(
                        child: SpiderChart(
                          data: _getRadarData(_selectedRadar),
                          maxValue: 1.0,
                          size: MediaQuery.of(context).size.width * 0.45,
                        ),
                      ),
                      const SizedBox(height: 10),
                    ],
                  ),
                ),
              ),
            ),

            // STRENGTHS & IMPROVEMENTS
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 32, left: 24, right: 24),
                child: Row(
                  children: [
                    Expanded(
                      child: _buildKeyAreaCard(
                        t,
                        "Strengths",
                        ["Communication", "Domain Knowledge"],
                        FeatherIcons.zap,
                        t.accentGreen,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _buildKeyAreaCard(
                        t,
                        "To Improve",
                        ["Body Language", "Pacing"],
                        FeatherIcons.trendingUp,
                        t.warning,
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // TIPS SECTION
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(top: 32, left: 24, right: 24),
                child: GlassCard(
                  hasMetallicBorder: true,
                  tintColor: t.primary,
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(
                            FeatherIcons.helpCircle,
                            color: Colors.white,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          const Text(
                            "Improvement Tip",
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        "Try maintaining more consistent eye contact and reducing filler words like 'um' and 'ah' to appear more confident.",
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.white.withOpacity(0.8),
                          height: 1.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // RECENT ACTIVITY
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(
                  top: 32,
                  left: 24,
                  right: 24,
                  bottom: 12,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _buildSectionTitle(t, "Recent Activity"),
                    GestureDetector(
                      onTap: () => TabsScreen.setIndex(context, 2),
                      child: Text(
                        "See All",
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: t.primary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: EdgeInsets.only(
                left: 24,
                right: 24,
                bottom: bottomPadding + 100,
              ),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate((context, index) {
                  final s = sessions[index];
                  return _buildActivityItem(t, s);
                }, childCount: math.min(sessions.length, 3)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(AppThemeColors t, String title) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.bold,
        color: t.text,
        letterSpacing: -0.5,
      ),
    );
  }

  Widget _buildScoreDisplay(AppThemeColors t, int score) {
    return GlassCard(
      hasMetallicBorder: true,
      hasGlow: true,
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                "Avg Score",
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Colors.white70,
                ),
              ),
              Icon(FeatherIcons.trendingUp, size: 14, color: t.accentGreen),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                "$score",
                style: const TextStyle(
                  fontSize: 48,
                  fontWeight: FontWeight.w900,
                  color: Colors.white,
                  height: 1.0,
                ),
              ),
              const Padding(
                padding: EdgeInsets.only(bottom: 8, left: 4),
                child: Text(
                  "/100",
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: Colors.white38,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMiniStatCard(
    AppThemeColors t,
    String label,
    String val,
    IconData icon,
    Color color,
  ) {
    return GlassCard(
      hasMetallicBorder: true,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(height: 12),
          Text(
            val,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: t.text,
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(fontSize: 11, color: t.textTertiary)),
        ],
      ),
    );
  }

  Widget _buildModuleTile(
    AppThemeColors t,
    String title,
    String subtitle,
    IconData icon,
    Color color,
  ) {
    return GlassCard(
      hasMetallicBorder: true,
      padding: EdgeInsets.zero,
      child: Stack(
        children: [
          // Background Glow (Localized)
          Positioned(
            left: -20,
            top: -20,
            child: Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: color.withOpacity(0.12),
                    blurRadius: 40,
                    spreadRadius: 10,
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Row(
              children: [
                // Left: Icon in square
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: t.bgSecondary,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: t.border.withOpacity(0.5),
                      width: 0.8,
                    ),
                  ),
                  child: Center(child: Icon(icon, size: 26, color: color)),
                ),
                const SizedBox(width: 16),
                // Right: Text stack
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                          color: t.text,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        style: TextStyle(
                          fontSize: 11,
                          color: t.textTertiary,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildModuleStats(AppThemeColors t, String title, String high) {
    return AnimatedBuilder(
      animation: _flipEffectController,
      builder: (context, child) {
        return GlassCard(
          hasMetallicBorder: true,
          padding: EdgeInsets.zero,
          child: Stack(
            children: [
              // Circular Expanding Color Leak
              Center(
                child: Container(
                  width: 200 * _flipEffectController.value,
                  height: 200 * _flipEffectController.value,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [t.primary.withOpacity(0.15), Colors.transparent],
                    ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: Colors.white70,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      high,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      "Keep going!",
                      style: TextStyle(fontSize: 9, color: Colors.white38),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildRadarDropdown(AppThemeColors t) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      height: 40,
      decoration: BoxDecoration(
        color: t.bgSecondary.withOpacity(0.25),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: t.metallicBorder.withOpacity(0.3),
          width: 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: t.primary.withOpacity(0.12),
            blurRadius: 20,
            spreadRadius: 2,
          ),
        ],
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: _selectedRadar,
          icon: Icon(FeatherIcons.chevronDown, size: 14, color: t.primary),
          dropdownColor: t.cardElevated.withOpacity(0.98),
          elevation: 12,
          borderRadius: BorderRadius.circular(14),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w900,
            color: t.text,
            letterSpacing: -0.2,
          ),
          items: const [
            DropdownMenuItem(value: "overall", child: Text("Overall")),
            DropdownMenuItem(value: "resume", child: Text("Resume")),
            DropdownMenuItem(value: "hr", child: Text("HR")),
            DropdownMenuItem(value: "website", child: Text("Website")),
            DropdownMenuItem(value: "intro", child: Text("Intro")),
          ],
          onChanged: (v) {
            if (v != null) setState(() => _selectedRadar = v);
          },
        ),
      ),
    );
  }

  Widget _buildKeyAreaCard(
    AppThemeColors t,
    String title,
    List<String> items,
    IconData icon,
    Color color,
  ) {
    return GlassCard(
      hasMetallicBorder: true,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 8),
              Text(
                title,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  color: t.text,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...items.map(
            (it) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Container(
                    width: 4,
                    height: 4,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: t.textTertiary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      it,
                      style: TextStyle(fontSize: 11, color: t.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActivityItem(AppThemeColors t, Session s) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: t.bgSecondary,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: t.metallicBorder.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: t.primary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(FeatherIcons.zap, size: 18, color: t.primary),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.topic,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: t.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  s.date,
                  style: TextStyle(fontSize: 12, color: t.textSecondary),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: t.accentGreen.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              "${s.score}%",
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: t.accentGreen,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Map<String, double> _getRadarData(String module) {
    if (module == "resume")
      return {
        "Comm": 0.70,
        "Tech": 0.95,
        "Logic": 0.85,
        "Fit": 0.60,
        "Conf": 0.80,
        "Lead": 0.50,
      };
    if (module == "hr")
      return {
        "Comm": 0.95,
        "Tech": 0.50,
        "Logic": 0.80,
        "Fit": 0.95,
        "Conf": 0.90,
        "Lead": 0.85,
      };
    return {
      "Comm": 0.85,
      "Tech": 0.70,
      "Logic": 0.90,
      "Fit": 0.80,
      "Conf": 0.75,
      "Lead": 0.60,
    };
  }
}
