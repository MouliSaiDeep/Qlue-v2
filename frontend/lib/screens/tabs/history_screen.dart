import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../core/mock_data.dart';
import '../../components/staggered_fade_in.dart';
import '../feedback/feedback_report_screen.dart';
import '../../components/glass_card.dart';
import '../../components/avatar.dart';
import '../../components/spectral_background.dart';
import '../../context/auth_provider.dart';
import 'profile_screen.dart';

class TimelineSessionCard extends StatelessWidget {
  final Session s;
  final bool isLast;
  
  const TimelineSessionCard({super.key, required this.s, this.isLast = false});

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final gradientColors = t.primaryGradient;
    
    // Icon mapping
    IconData moduleIcon;
    switch (s.module.toLowerCase()) {
      case 'resume': moduleIcon = FeatherIcons.fileText; break;
      case 'hr': moduleIcon = FeatherIcons.users; break;
      case 'website': moduleIcon = FeatherIcons.globe; break;
      case 'intro': moduleIcon = FeatherIcons.mic; break;
      default: moduleIcon = FeatherIcons.zap;
    }

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Timeline Indicator Column (Top-aligned)
          SizedBox(
            width: 40,
            child: Column(
              children: [
                Container(
                  width: 38, height: 38,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [gradientColors[0].withOpacity(0.7), gradientColors[1]],
                      begin: Alignment.topLeft, end: Alignment.bottomRight,
                    ),
                    border: Border.all(color: Colors.white10, width: 1),
                    boxShadow: [
                      BoxShadow(color: gradientColors[1].withOpacity(0.35), blurRadius: 15, offset: const Offset(0, 4)),
                      // Outer Light Leak
                      BoxShadow(color: gradientColors[1].withOpacity(0.2), blurRadius: 25, spreadRadius: 2),
                    ],
                  ),
                  child: Center(child: Icon(moduleIcon, size: 16, color: Colors.white)),
                ),
                if (!isLast)
                Expanded(
                  child: Container(
                    width: 2,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [gradientColors[1].withOpacity(0.8), t.border.withOpacity(0.05)],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          // Content Card
          Expanded(
          child: GestureDetector(
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => FeedbackReportScreen(session: s))),
          child: Container(
            margin: const EdgeInsets.only(bottom: 24),
            child: GlassCard(
              hasMetallicBorder: true,
              borderRadius: 20,
              padding: const EdgeInsets.all(20),
              // Grey hardware gradient
              fillAlpha: 0.08,
              tintColor: Colors.grey,
              child: Stack(
                children: [
                  // Hardware Texture Emulation
                  Positioned.fill(
                    child: Opacity(
                      opacity: 0.03,
                      child: Image.network(
                        "https://www.transparenttextures.com/patterns/carbon-fibre.png",
                        repeat: ImageRepeat.repeat,
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(s.date.toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: t.textTertiary, letterSpacing: 1.5)),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: t.primary.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: t.primary.withOpacity(0.2)),
                            ),
                            child: Text("${s.score}%", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: t.primary)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Text(s.topic, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: t.text, letterSpacing: -0.8)),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Icon(FeatherIcons.zap, size: 12, color: t.primary),
                          const SizedBox(width: 8),
                          Text("${s.module[0].toUpperCase()}${s.module.substring(1).toLowerCase()} • ${s.duration ~/ 60}m Practice", style: TextStyle(fontSize: 12, color: t.textSecondary, fontWeight: FontWeight.w500)),
                        ],
                      ),
                      const SizedBox(height: 20),
                      Wrap(
                        spacing: 8,
                        children: s.tags.take(2).map((tag) => Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: t.bgSecondary,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: t.border.withOpacity(0.5)),
                          ),
                          child: Text(tag, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: t.textSecondary)),
                        )).toList(),
                      ),
                    ],
                  ),
                ],
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

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  String _selectedFilter = 'Date'; // 'Date', 'Module', 'Score'
  
  List<Session> _getFilteredSessions() {
    List<Session> sessions = List.from(mockSessions);
    
    if (_selectedFilter == 'Score') {
      sessions.sort((a, b) => b.score.compareTo(a.score));
    } else if (_selectedFilter == 'Module') {
      sessions.sort((a, b) => a.module.compareTo(b.module));
    } else {
      // Date based (chrono)
      sessions = List.from(mockSessions);
    }
    return sessions;
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final sessions = _getFilteredSessions();
    final topPadding = MediaQuery.of(context).padding.top;
    final total = sessions.length;
    final avgScore = total > 0 ? (sessions.fold(0, (sum, s) => sum + s.score) / total).round() : 0;

    final auth = Provider.of<AuthProvider>(context);

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: CustomScrollView(
          slivers: [
            // HEADER WITH AVATAR
            SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.only(top: topPadding + 16, left: 24, right: 24, bottom: 20),
                child: Row(
                  children: [
                     GestureDetector(
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfileScreen())),
                      child: Avatar(
                        imageUrl: auth.profileImageUrl,
                        size: 44,
                        isCircle: true,
                        border: Border.all(color: t.metallicBorder.withOpacity(0.5), width: 1),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text("Previous", style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: t.text, letterSpacing: -0.5)),
                        Text("Practice History", style: TextStyle(fontSize: 11, color: t.textSecondary, fontWeight: FontWeight.w500)),
                      ],
                    ),
                    const Spacer(),
                    // Stylized Trail Icon (Functional Filter)
                    PopupMenuButton<String>(
                      initialValue: _selectedFilter,
                      onSelected: (val) => setState(() => _selectedFilter = val),
                      color: t.cardElevated.withOpacity(0.95),
                      elevation: 10,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: BorderSide(color: t.border.withOpacity(0.3))),
                      offset: const Offset(0, 50),
                      itemBuilder: (context) => [
                        _buildPopupItem(t, 'Date', FeatherIcons.calendar),
                        _buildPopupItem(t, 'Score', FeatherIcons.award),
                        _buildPopupItem(t, 'Module', FeatherIcons.box),
                      ],
                      child: Container(
                        width: 44, height: 44,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: t.metallicBorder.withOpacity(0.4), width: 1.2),
                          color: t.bgSecondary.withOpacity(0.5),
                        ),
                        child: Center(child: Icon(FeatherIcons.sliders, size: 20, color: t.text)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                     Text("Showing by $_selectedFilter", style: TextStyle(fontSize: 14, color: t.primary, fontWeight: FontWeight.bold)),
                     const SizedBox(height: 20),
                     Row(
                       children: [
                         _buildBadge(t, "Total", "$total"),
                         const SizedBox(width: 8),
                         _buildBadge(t, "Avg", "$avgScore%"),
                         const SizedBox(width: 8),
                         _buildBadge(t, "Streak", "5d"),
                       ],
                     ),
                     const SizedBox(height: 32),
                     Text("Timeline", style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.2, color: t.textTertiary)),
                     const SizedBox(height: 24),
                  ],
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.only(left: 24, right: 24, bottom: 120),
              sliver: SliverList(delegate: SliverChildBuilderDelegate(
                (context, index) => StaggeredFadeIn(
                  key: ValueKey("${sessions[index].id}_$_selectedFilter"), // Force rebuild on filter
                  delay: Duration(milliseconds: index * 100),
                  child: TimelineSessionCard(
                    s: sessions[index], 
                    isLast: index == sessions.length - 1
                  ),
                ),
                childCount: sessions.length,
              )),
            ),
          ],
        ),
      ),
    );
  }

  PopupMenuItem<String> _buildPopupItem(AppThemeColors t, String val, IconData icon) {
    final isSel = _selectedFilter == val;
    return PopupMenuItem(
      value: val,
      child: Row(
        children: [
          Icon(icon, size: 16, color: isSel ? t.primary : t.textTertiary),
          const SizedBox(width: 12),
          Text(val, style: TextStyle(color: isSel ? t.text : t.textSecondary, fontWeight: isSel ? FontWeight.bold : FontWeight.normal)),
        ],
      ),
    );
  }

  Widget _buildBadge(AppThemeColors t, String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: t.bgSecondary,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: t.metallicBorder.withOpacity(0.1)),
      ),
      child: Row(
        children: [
          Text("$label: ", style: TextStyle(fontSize: 12, color: t.textTertiary)),
          Text(value, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: t.text)),
        ],
      ),
    );
  }
}
