import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../core/models/resume_model.dart';
import '../../context/resume_provider.dart';
import '../../components/spectral_background.dart';
import '../../components/glass_card.dart';
import '../../components/confirmation_dialog.dart';
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
            color: Colors.black.withValues(alpha: 0.05),
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
                    color: iconColor.withValues(alpha: 0.1),
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
  final String resumeId;

  const ResumeDetailScreen({super.key, required this.resumeId});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ResumeProvider>();
    final resumeIdx = provider.resumes.indexWhere((r) => r.resumeId == resumeId);
    if (resumeIdx == -1) {
      return Scaffold(
        appBar: AppBar(title: const Text('Not Found')),
        body: const Center(child: Text("Resume not found.")),
      );
    }
    final resume = provider.resumes[resumeIdx];

    final topPadding = MediaQuery.of(context).padding.top;
    final bottomPadding = MediaQuery.of(context).padding.bottom;

    final isParsed = resume.status == ResumeStatus.parsed;
    final isParsing = resume.status == ResumeStatus.parsing || resume.status == ResumeStatus.uploading;
    final isFailed = resume.status == ResumeStatus.failed;

    final headerColors = resume.fileName.toLowerCase().endsWith("pdf")
        ? [const Color(0xFFC72B2B), const Color(0xFFEF4444)]
        : [const Color(0xFF1D4ED8), const Color(0xFF2563EB)];

    Map<ResumeStatus, Map<String, dynamic>> statusMap = {
      ResumeStatus.parsed: {"label": "Ready to use", "color": const Color(0xFF22C55E), "bg": const Color(0xFF22C55E).withValues(alpha: 0.15)},
      ResumeStatus.parsing: {"label": "Parsing...", "color": const Color(0xFFF59E0B), "bg": const Color(0xFFF59E0B).withValues(alpha: 0.15)},
      ResumeStatus.uploading: {"label": "Uploading...", "color": const Color(0xFFF59E0B), "bg": const Color(0xFFF59E0B).withValues(alpha: 0.15)},
      ResumeStatus.pending: {"label": "Pending", "color": const Color(0xFF94A3B8), "bg": const Color(0xFF94A3B8).withValues(alpha: 0.15)},
      ResumeStatus.failed: {"label": "Failed", "color": const Color(0xFFEF4444), "bg": const Color(0xFFEF4444).withValues(alpha: 0.15)},
    };
    final status = statusMap[resume.status] ?? statusMap[ResumeStatus.pending]!;

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
                            color: Colors.white.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Center(
                            child: Icon(FeatherIcons.fileText, size: 28, color: Colors.white.withValues(alpha: 0.9)),
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                resume.fileName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: Colors.white),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  _heroPill(FeatherIcons.layers, resume.fileName.split('.').last.toUpperCase()),
                                  _heroPill(FeatherIcons.hardDrive, "${(resume.fileSize / 1024 / 1024).toStringAsFixed(1)} MB"),
                                  if (resume.uploadedAt != null)
                                    _heroPill(FeatherIcons.calendar, "Recently"),
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
                          const Color(0xFFF59E0B).withValues(alpha: 0.1),
                          "Parsing resume...",
                          "Extracting skills, experience & education",
                        ),
                      if (isFailed)
                        _buildStateCard(
                          t,
                          FeatherIcons.alertTriangle,
                          AppColors.semanticError,
                          AppColors.semanticError.withValues(alpha: 0.1),
                          "Parsing failed",
                          "Please try uploading again",
                        ),
                      if (resume.parsedData != null) ...[
                         DetailSection(
                          title: "AI Technical Profile",
                          icon: FeatherIcons.activity,
                          iconColor: const Color(0xFF10B981),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  "Your technical background has been fully indexed. The AI interviewer will use these details to ground your technical assessment in your actual experience.",
                                  style: TextStyle(fontSize: 13, color: t.textSecondary, height: 1.5),
                                ),
                                const SizedBox(height: 16),
                                Row(
                                  children: [
                                    _statPill(FeatherIcons.briefcase, "${resume.parsedData?.workExperience?.length ?? 0} Experiences", t),
                                    const SizedBox(width: 8),
                                    _statPill(FeatherIcons.code, "${resume.parsedData?.projects?.length ?? 0} Projects", t),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (resume.parsedData?.name != null) ...[
                        DetailSection(
                          title: "Candidate Name",
                          icon: FeatherIcons.user,
                          iconColor: const Color(0xFF8B5CF6),
                          child: Padding(
                            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
                            child: Text(
                              resume.parsedData!.name!,
                              style: TextStyle(fontSize: 16, color: t.text, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (resume.parsedData?.skills != null && resume.parsedData!.skills!.isNotEmpty) ...[
                        DetailSection(
                          title: "Skills & Technologies",
                          icon: FeatherIcons.tag,
                          iconColor: const Color(0xFF3B82F6),
                          child: Padding(
                            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
                            child: Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: resume.parsedData!.skills!.map((s) => SkillTag(label: s)).toList(),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (resume.parsedData?.workExperience != null && resume.parsedData!.workExperience!.isNotEmpty) ...[
                        DetailSection(
                          title: "Work Experience",
                          icon: FeatherIcons.briefcase,
                          iconColor: const Color(0xFFDB2777),
                          child: Column(
                            children: resume.parsedData!.workExperience!.asMap().entries.map((entry) {
                              int i = entry.key;
                              WorkExperienceModel exp = entry.value;
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
                                                        Text(exp.role ?? 'Unknown Role', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                                        const SizedBox(height: 2),
                                                        Text(exp.company ?? 'Unknown Company', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: t.textSecondary)),
                                                      ],
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            if (exp.duration != null)
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFDB2777).withValues(alpha: 0.08),
                                                  borderRadius: BorderRadius.circular(8),
                                                ),
                                                child: Text(exp.duration!, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFFDB2777))),
                                              ),
                                          ],
                                        ),
                                        if (exp.highlights != null && exp.highlights!.isNotEmpty) ...[
                                          const SizedBox(height: 8),
                                          Padding(
                                            padding: const EdgeInsets.only(left: 18),
                                            child: Text(
                                              exp.highlights!.join('\n• '),
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
                      if (resume.parsedData?.projects != null && resume.parsedData!.projects!.isNotEmpty) ...[
                        DetailSection(
                          title: "Projects",
                          icon: FeatherIcons.code,
                          iconColor: const Color(0xFF10B981),
                          child: Column(
                            children: resume.parsedData!.projects!.map((proj) {
                              return Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(proj.name ?? 'Project', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                    if (proj.description != null) ...[
                                      const SizedBox(height: 4),
                                      Text(proj.description!, style: TextStyle(fontSize: 12, color: t.textSecondary)),
                                    ],
                                  ],
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      if (resume.parsedData?.education != null && resume.parsedData!.education!.isNotEmpty)
                        DetailSection(
                          title: "Education",
                          icon: FeatherIcons.bookOpen,
                          iconColor: const Color(0xFF0891B2),
                          child: Column(
                            children: resume.parsedData!.education!.asMap().entries.map((entry) {
                              int i = entry.key;
                              EducationModel edu = entry.value;
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
                                                    Text(edu.degree ?? 'Unknown Degree', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                                    const SizedBox(height: 2),
                                                    Text(edu.institution ?? 'Unknown Institution', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: t.textSecondary)),
                                                  ],
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        if (edu.year != null)
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: const Color(0xFF0891B2).withValues(alpha: 0.08),
                                              borderRadius: BorderRadius.circular(8),
                                            ),
                                            child: Text(edu.year!, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF0891B2))),
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
                          MaterialPageRoute(builder: (_) => InterviewSessionScreen(resumeId: resumeId)),
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
                            Icon(FeatherIcons.arrowRight, size: 16, color: Colors.white.withValues(alpha: 0.7)),
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
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: Colors.white.withValues(alpha: 0.6)),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: Colors.white.withValues(alpha: 0.7)),
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
        border: Border.all(color: iconColor.withValues(alpha: 0.25)),
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

  Widget _statPill(IconData icon, String label, AppThemeColors t) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: t.bgSecondary,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: t.border.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: t.primary),
          const SizedBox(width: 6),
          Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: t.textSecondary)),
        ],
      ),
    );
  }

  void _handleDelete(BuildContext context) async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: "Delete Resume?",
      message: "This will permanently remove your document.",
      confirmLabel: "Delete",
      confirmColor: AppThemeColors.of(context).error,
      icon: FeatherIcons.trash2,
    );

    if (confirmed == true && context.mounted) {
      context.read<ResumeProvider>().deleteResume(resumeId);
      Navigator.of(context).pop();
    }
  }
}
