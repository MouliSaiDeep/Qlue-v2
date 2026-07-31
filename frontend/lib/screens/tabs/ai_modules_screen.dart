import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../core/theme.dart';
import '../../core/mock_data.dart';
import '../../components/glass_card.dart';
import '../../components/avatar.dart';
import '../../components/spectral_background.dart';
import '../../context/auth_provider.dart';
import '../interview/interview_session_screen.dart';
import '../resume/resume_upload_screen.dart';
import 'profile_screen.dart';

class AIModulesScreen extends StatefulWidget {
  const AIModulesScreen({super.key});

  @override
  State<AIModulesScreen> createState() => _AIModulesScreenState();
}

class _AIModulesScreenState extends State<AIModulesScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  Resume? _selectedResume;
  final TextEditingController _urlController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  void _showResumePopup() {
    final t = AppThemeColors.of(context);
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) {
        return GlassCard(
          margin: const EdgeInsets.only(top: 100),
          padding: const EdgeInsets.all(24),
          borderRadius: 32,
          hasMetallicBorder: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: t.border.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    "Select Resume",
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: t.text,
                    ),
                  ),
                  IconButton(
                    icon: Icon(FeatherIcons.x, color: t.textSecondary),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: mockResumes.length,
                  itemBuilder: (context, index) {
                    final r = mockResumes[index];
                    final isSelected = _selectedResume?.id == r.id;
                    return GestureDetector(
                      onTap: () {
                        setState(() => _selectedResume = r);
                        Navigator.pop(ctx);
                      },
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? t.primary.withOpacity(0.15)
                              : t.bgSecondary,
                          border: Border.all(
                            color: isSelected
                                ? t.primary
                                : t.border.withOpacity(0.5),
                          ),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              FeatherIcons.fileText,
                              color: isSelected ? t.primary : t.textSecondary,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                r.filename,
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: t.text,
                                ),
                              ),
                            ),
                            if (isSelected)
                              Icon(FeatherIcons.checkCircle, color: t.primary),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final topPadding = MediaQuery.of(context).padding.top;

    final auth = Provider.of<AuthProvider>(context);

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // HEADER
            Padding(
              padding: EdgeInsets.only(
                top: topPadding + 16,
                left: 24,
                right: 24,
                bottom: 20,
              ),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const ProfileScreen()),
                    ),
                    child: Avatar(
                      imageUrl: auth.profileImageUrl,
                      size: 44,
                      isCircle: true,
                      border: Border.all(
                        color: t.metallicBorder.withOpacity(0.5),
                        width: 1.5,
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          "Practice",
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: t.text,
                            letterSpacing: -0.5,
                          ),
                        ),
                        Text(
                          "AI Learning Modules",
                          style: TextStyle(
                            fontSize: 11,
                            color: t.textSecondary,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  GestureDetector(
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ResumeUploadScreen(),
                      ),
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: t.primaryGradient),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: Colors.white.withOpacity(0.4),
                          width: 0.8,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: t.primary.withOpacity(0.3),
                            blurRadius: 15,
                            spreadRadius: 1,
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            FeatherIcons.fileText,
                            size: 13,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            "Upload Resume",
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                              fontFamily: 'Montserrat',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // CUSTOM GLASS TAB BAR (PILL STYLE)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: SizedBox(
                height: 54,
                child: GlassCard(
                  borderRadius: 30,
                  padding: const EdgeInsets.all(4),
                  hasMetallicBorder: true,
                  child: AnimatedBuilder(
                    animation: _tabController,
                    builder: (context, _) {
                      return Stack(
                        children: [
                          // Sliding Indicator
                          AnimatedAlign(
                            duration: const Duration(milliseconds: 300),
                            curve: Curves.easeOutQuart,
                            alignment: _tabController.index == 0
                                ? Alignment.centerLeft
                                : Alignment.centerRight,
                            child: FractionallySizedBox(
                              widthFactor: 0.5,
                              child: Container(
                                decoration: BoxDecoration(
                                  color: t.primary,
                                  borderRadius: BorderRadius.circular(24),
                                  boxShadow: [
                                    BoxShadow(
                                      color: t.primary.withOpacity(0.4),
                                      blurRadius: 12,
                                      spreadRadius: 1,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          // Tab Items
                          Row(
                            children: [
                              Expanded(
                                child: _buildCustomTab(0, "AI Interview", t),
                              ),
                              Expanded(
                                child: _buildCustomTab(1, "AI Tutor", t),
                              ),
                            ],
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ),
            ),

            // TAB CONTENT
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [_buildInterviewList(t), _buildTutorList(t)],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomTab(int index, String label, AppThemeColors t) {
    final isSelected = _tabController.index == index;
    return GestureDetector(
      onTap: () => setState(() => _tabController.index = index),
      behavior: HitTestBehavior.opaque,
      child: Center(
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
            color: isSelected ? Colors.white : t.textTertiary,
          ),
        ),
      ),
    );
  }

  Widget _buildInterviewList(AppThemeColors t) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        _buildModuleCard(
          t,
          "Resume",
          "Analyze key skills and work history.",
          _selectedResume != null
              ? "Selected: ${_selectedResume!.filename}"
              : "No resume selected",
          "Resume",
          "assets/images/Resume.png",
          onFeatureTap: _showResumePopup,
        ),
        const SizedBox(height: 24),
        _buildModuleCard(
          t,
          "HR",
          "Practice behavioral and situational questions.",
          "Analyze your culture fit.",
          "HR",
          "assets/images/hr.png",
        ),
      ],
    );
  }

  Widget _buildTutorList(AppThemeColors t) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        _buildModuleCard(
          t,
          "Website",
          "Learn from educational URL content.",
          "Enter link below",
          "Website",
          "assets/images/website.png",
          featureWidget: Container(
            height: 52,
            margin: const EdgeInsets.only(top: 12),
            child: TextField(
              controller: _urlController,
              style: TextStyle(color: t.text, fontSize: 13),
              decoration: InputDecoration(
                hintText: "https://example.com/topic",
                hintStyle: TextStyle(color: t.textTertiary, fontSize: 13),
                filled: true,
                fillColor: t.bgSecondary.withOpacity(0.4),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                prefixIcon: Icon(FeatherIcons.link, size: 14, color: t.primary),
              ),
            ),
          ),
        ),
        const SizedBox(height: 24),
        _buildModuleCard(
          t,
          "Self-Intro",
          "Record your professional introduction.",
          "Evaluate clarity and delivery.",
          "Intro",
          "assets/images/SelfIntro.png",
        ),
      ],
    );
  }

  Widget _buildModuleCard(
    AppThemeColors t,
    String title,
    String desc,
    String featureText,
    String tag,
    String imagePath, {
    VoidCallback? onFeatureTap,
    Widget? featureWidget,
  }) {
    Color glowColor;
    switch (tag.toLowerCase()) {
      case 'resume':
        glowColor = t.accentGreen;
        break;
      case 'hr':
        glowColor = Colors.orangeAccent;
        break;
      case 'website':
        glowColor = t.moduleWeb;
        break;
      case 'intro':
        glowColor = t.accentGreen;
        break;
      default:
        glowColor = t.primary;
    }

    return GlassCard(
      hasMetallicBorder: true,
      glowColor: glowColor,
      glowRadius: 50,
      padding: const EdgeInsets.all(24),
      child: SizedBox(
        height: 220, // Fixed internal height for synchronization
        child: Row(
          children: [
            Expanded(
              flex: 4,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment:
                    MainAxisAlignment.spaceBetween, // Push button to bottom
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.bold,
                          color: t.text,
                          letterSpacing: -0.8,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        desc,
                        style: TextStyle(
                          fontSize: 13,
                          color: t.textSecondary,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),

                  // FEATURE AREA (CHIP STYLE, NO UNDERLINE)
                  if (featureWidget != null)
                    featureWidget
                  else
                    GestureDetector(
                      onTap: onFeatureTap,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: t.bgSecondary.withOpacity(0.5),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: Colors.white.withOpacity(0.2),
                            width: 1,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.2),
                              blurRadius: 10,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            ShaderMask(
                              shaderCallback: (bounds) => LinearGradient(
                                colors: t.chromeGradient,
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ).createShader(bounds),
                              child: Icon(
                                onFeatureTap != null
                                    ? FeatherIcons.fileText
                                    : FeatherIcons.info,
                                size: 16,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Flexible(
                              child: Text(
                                featureText,
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: t.text,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                  // METALLIC START BUTTON
                  GestureDetector(
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const InterviewSessionScreen(),
                      ),
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 28,
                        vertical: 14,
                      ),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: t.primaryGradient),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: Colors.white.withOpacity(0.4),
                          width: 0.8,
                        ), // Metallic edge
                        boxShadow: [
                          BoxShadow(
                            color: t.primary.withOpacity(0.4),
                            blurRadius: 20,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                      child: const Text(
                        "Start Practice",
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // IMAGE
            Expanded(
              flex: 3,
              child: Hero(
                tag: "knight_$title",
                child: Image.asset(
                  imagePath,
                  height: 250,
                  width: 140,
                  fit: BoxFit.contain,
                  alignment: Alignment.centerRight,
                  errorBuilder: (context, error, stackTrace) => Icon(
                    FeatherIcons.image,
                    size: 100,
                    color: t.border.withOpacity(0.3),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
