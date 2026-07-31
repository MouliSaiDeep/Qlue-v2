import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../core/theme.dart';
import '../../core/mock_data.dart';
import '../../components/spectral_background.dart';
import '../../components/glass_card.dart';
import '../interview/interview_session_screen.dart';

class SkillTag extends StatelessWidget {
  final String label;
  const SkillTag({super.key, required this.label});

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: t.primaryMuted,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: t.primary),
      ),
    );
  }
}

class DetailSection extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color iconColor;
  final Widget child;

  const DetailSection({
    super.key,
    required this.title,
    required this.icon,
    required this.iconColor,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    return Container(
      decoration: BoxDecoration(
        color: t.card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: t.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            offset: const Offset(0, 2),
            blurRadius: 8,
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 12),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: iconColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Center(child: Icon(icon, size: 15, color: iconColor)),
                ),
                const SizedBox(width: 10),
                Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: t.text)),
              ],
            ),
          ),
          child,
        ],
      ),
    );
  }
}

class ResumeDetailScreen extends StatelessWidget {
  final Resume resume;

  const ResumeDetailScreen({super.key, required this.resume});

  @override
  Widget build(BuildContext context) {
    final topPadding = MediaQuery.of(context).padding.top;
    final bottomPadding = MediaQuery.of(context).padding.bottom;

    final isParsed = resume.status == "parsed";
    final isParsing = resume.status == "parsing";
    final isFailed = resume.status == "failed";

    final headerColors = resume.format == "pdf"
        ? [const Color(0xFFC72B2B), const Color(0xFFEF4444)]
        : [const Color(0xFF1D4ED8), const Color(0xFF2563EB)];

    Map<String, Map<String, dynamic>> statusMap = {
      "parsed": {"label": "Ready to use", "color": const Color(0xFF22C55E), "bg": const Color(0xFF22C55E).withOpacity(0.15)},
      "parsing": {"label": "Parsing...", "color": const Color(0xFFF59E0B), "bg": const Color(0xFFF59E0B).withOpacity(0.15)},
      "failed": {"label": "Failed", "color": const Color(0xFFEF4444), "bg": const Color(0xFFEF4444).withOpacity(0.15)},
    };
    final status = statusMap[resume.status]!;

    final t = AppThemeColors.of(context);
    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
      body: Stack(
        children: [
          Column(
            children: [
              // Hero header
              Container(
                padding: EdgeInsets.only(top: topPadding + 16, bottom: 24, left: 20, right: 20),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: headerColors,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: Column(
                  children: [
                    // Nav
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        GestureDetector(
                          onTap: () => Navigator.of(context).pop(),
                          child: SizedBox(
                            width: 44,
                            height: 44,
                            child: GlassCard(
                              borderRadius: 12,
                              padding: EdgeInsets.zero,
                              hasMetallicBorder: true,
                              child: Center(child: Icon(FeatherIcons.chevronLeft, size: 20, color: Colors.white)),
                            ),
                          ),
                        ),
                        GestureDetector(
                          onTap: () => _handleDelete(context),
                          child: SizedBox(
                            width: 44,
                            height: 44,
                            child: GlassCard(
                              borderRadius: 12,
                              padding: EdgeInsets.zero,
                              hasMetallicBorder: true,
                              child: const Center(child: Icon(FeatherIcons.trash2, size: 18, color: Colors.white)),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    // File info
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 60,
                          height: 60,
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Center(
                            child: Icon(FeatherIcons.fileText, size: 28, color: Colors.white.withOpacity(0.9)),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                resume.filename,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: Colors.white),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  _heroPill(FeatherIcons.layers, resume.format),
                                  _heroPill(FeatherIcons.hardDrive, resume.fileSize),
                                  _heroPill(FeatherIcons.calendar, resume.uploadDate),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: status["bg"] as Color,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Container(
                                      width: 6,
                                      height: 6,
                                      decoration: BoxDecoration(
                                        color: status["color"] as Color,
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      status["label"] as String,
                                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: status["color"] as Color),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // Content
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.only(top: 14, left: 14, right: 14, bottom: isParsed ? bottomPadding + 110 : bottomPadding + 40),
                  child: Column(
                    children: [
                      if (isParsing)
                        _buildStateCard(
                          t,
                          FeatherIcons.loader,
                          const Color(0xFFF59E0B),
                          const Color(0xFFF59E0B).withOpacity(0.1),
                          "Parsing resume...",
                          "Extracting skills, experience & education",
                        ),
                      if (isFailed)
                        _buildStateCard(
                          t,
                          FeatherIcons.alertTriangle,
                          AppColors.semanticError,
                          AppColors.semanticError.withOpacity(0.1),
                          "Parsing failed",
                          "Please try uploading again",
                        ),
                      if (resume.summary != null) ...[
                        DetailSection(
                          title: "Summary",
                          icon: FeatherIcons.alignLeft,
                          iconColor: const Color(0xFF8B5CF6),
                          child: Padding(
                            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
                            child: Text(
                              resume.summary!,
                              style: TextStyle(fontSize: 14, color: t.textSecondary, height: 1.57),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (resume.skills.isNotEmpty) ...[
                        DetailSection(
                          title: "Skills & Technologies",
                          icon: FeatherIcons.tag,
                          iconColor: const Color(0xFF3B82F6),
                          child: Padding(
                            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
                            child: Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: resume.skills.map((s) => SkillTag(label: s)).toList(),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (resume.experience != null && resume.experience!.isNotEmpty) ...[
                        DetailSection(
                          title: "Work Experience",
                          icon: FeatherIcons.briefcase,
                          iconColor: const Color(0xFFDB2777),
                          child: Column(
                            children: resume.experience!.asMap().entries.map((entry) {
                              int i = entry.key;
                              Experience exp = entry.value;
                              return Column(
                                children: [
                                  if (i > 0) Container(height: 1, color: t.borderSubtle, margin: const EdgeInsets.only(left: 16)),
                                  Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Expanded(
                                              child: Row(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Container(
                                                    width: 8,
                                                    height: 8,
                                                    margin: const EdgeInsets.only(top: 5, right: 10),
                                                    decoration: BoxDecoration(
                                                      color: const Color(0xFFDB2777),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                  ),
                                                  Expanded(
                                                    child: Column(
                                                      crossAxisAlignment: CrossAxisAlignment.start,
                                                      children: [
                                                        Text(exp.role, style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                                        const SizedBox(height: 2),
                                                        Text(exp.company, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: t.textSecondary)),
                                                      ],
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                              decoration: BoxDecoration(
                                                color: const Color(0xFFDB2777).withOpacity(0.08),
                                                borderRadius: BorderRadius.circular(8),
                                              ),
                                              child: Text(exp.years, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFFDB2777))),
                                            ),
                                          ],
                                        ),
                                        if (exp.description != null) ...[
                                          const SizedBox(height: 8),
                                          Padding(
                                            padding: const EdgeInsets.only(left: 18),
                                            child: Text(
                                              exp.description!,
                                              style: TextStyle(fontSize: 12, color: t.textTertiary, height: 1.5),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ],
                              );
                            }).toList(),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (resume.education != null && resume.education!.isNotEmpty)
                        DetailSection(
                          title: "Education",
                          icon: FeatherIcons.bookOpen,
                          iconColor: const Color(0xFF0891B2),
                          child: Column(
                            children: resume.education!.asMap().entries.map((entry) {
                              int i = entry.key;
                              Education edu = entry.value;
                              return Column(
                                children: [
                                  if (i > 0) Container(height: 1, color: t.borderSubtle, margin: const EdgeInsets.only(left: 16)),
                                  Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Row(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Container(
                                                width: 8,
                                                height: 8,
                                                margin: const EdgeInsets.only(top: 5, right: 10),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFF0891B2),
                                                  borderRadius: BorderRadius.circular(4),
                                                ),
                                              ),
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment: CrossAxisAlignment.start,
                                                  children: [
                                                    Text(edu.degree, style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                                    const SizedBox(height: 2),
                                                    Text(edu.institution, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: t.textSecondary)),
                                                  ],
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFF0891B2).withOpacity(0.08),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Text(edu.year, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF0891B2))),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              );
                            }).toList(),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),

          // CTA Bar
          if (isParsed)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: Container(
                padding: EdgeInsets.only(top: 12, left: 16, right: 16, bottom: bottomPadding + 12),
                decoration: BoxDecoration(
                  color: t.card,
                  border: Border(top: BorderSide(color: t.border)),
                ),
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    gradient: const LinearGradient(
                      colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                    ),
                  ),
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => const InterviewSessionScreen()),
                        );
                      },
                      child: SizedBox(
                        height: 52,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(FeatherIcons.mic, size: 18, color: Colors.white),
                            const SizedBox(width: 10),
                            const Text(
                              "Start Interview Session",
                              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white),
                            ),
                            const SizedBox(width: 10),
                            Icon(FeatherIcons.arrowRight, size: 16, color: Colors.white.withOpacity(0.7)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _heroPill(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: Colors.white.withOpacity(0.6)),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: Colors.white.withOpacity(0.7)),
          ),
        ],
      ),
    );
  }

  Widget _buildStateCard(AppThemeColors t, IconData icon, Color iconColor, Color bgColor, String title, String subtitle) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bgColor,
        border: Border.all(color: iconColor.withOpacity(0.25)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(icon, size: 17, color: iconColor),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: iconColor)),
              const SizedBox(height: 2),
              Text(subtitle, style: TextStyle(fontSize: 12, color: t.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }

  void _handleDelete(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Delete Resume"),
        content: Text('Remove "${resume.filename}"?'),
        actions: [
          TextButton(child: const Text("Cancel"), onPressed: () => Navigator.of(ctx).pop()),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.semanticError),
            child: const Text("Delete"),
            onPressed: () {
              Navigator.of(ctx).pop();
              Navigator.of(context).pop();
            },
          ),
        ],
      ),
    );
  }
}
