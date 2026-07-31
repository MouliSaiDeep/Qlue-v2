import 'package:flutter/material.dart';
import '../../core/notifications.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:file_picker/file_picker.dart';
import 'dart:ui';
import '../../core/theme.dart';
import '../../core/mock_data.dart';
import '../../components/glass_card.dart';
import '../../components/spectral_background.dart';

class ResumeUploadScreen extends StatefulWidget {
  const ResumeUploadScreen({super.key});

  @override
  State<ResumeUploadScreen> createState() => _ResumeUploadScreenState();
}

class _ResumeUploadScreenState extends State<ResumeUploadScreen> {
  bool _isUploading = false;

  void _handleUpload() async {
    if (mockResumes.length >= 5) {
      Notify.error(context, "Maximum of 5 resumes allowed.");
      return;
    }

    FilePickerResult? result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'], // PDf only as requested
    );

    if (result != null && result.files.single.name.isNotEmpty) {
      final file = result.files.single;
      final fileName = file.name;
      final String fileSizeMB = file.size > 0 ? "${(file.size / (1024 * 1024)).toStringAsFixed(1)} MB" : "1.2 MB";

      setState(() => _isUploading = true);
      await Future.delayed(const Duration(seconds: 2));
      
      if (!mounted) return;
      setState(() {
        _isUploading = false;
        mockResumes.insert(0, Resume(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          filename: fileName,
          uploadDate: "Just now",
          status: "parsed",
          skills: ["Flutter", "Dart", "Firebase", "Clean Architecture", "UI/UX"],
          format: 'pdf',
          fileSize: fileSizeMB,
          summary: "Professional profile parsed. System mapping active for $fileName.",
          experience: [
            Experience(role: "Candidate", company: "Portfolio", years: "2024", description: "Parsed from local drive."),
          ],
          education: [
            Education(degree: "Software Engineering", institution: "Tech Univ", year: "2023"),
          ]
        ));
      });
      Notify.success(context, "Resume uploaded and indexed.");
    }
  }

  void _handleDelete(int index) {
    setState(() {
      mockResumes.removeAt(index);
    });
  }

  void _showParsedPreview(Resume r) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final t = AppThemeColors.of(ctx);
        return GlassCard(
          margin: const EdgeInsets.only(top: 80),
          padding: const EdgeInsets.all(24),
          borderRadius: 32,
          hasMetallicBorder: true,
          child: Column(
            children: [
               Container(width: 40, height: 4, decoration: BoxDecoration(color: t.border.withOpacity(0.3), borderRadius: BorderRadius.circular(2))),
               const SizedBox(height: 24),
               Row(
                 children: [
                   Container(
                     padding: const EdgeInsets.all(12),
                     decoration: BoxDecoration(color: t.primary.withOpacity(0.1), shape: BoxShape.circle),
                     child: Icon(FeatherIcons.fileText, color: t.primary, size: 24),
                   ),
                   const SizedBox(width: 16),
                   Expanded(
                     child: Column(
                       crossAxisAlignment: CrossAxisAlignment.start,
                       children: [
                         Text("Resume Profile", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: t.text)),
                         Text(r.filename, style: TextStyle(fontSize: 14, color: t.textSecondary)),
                       ],
                     )
                   ),
                   IconButton(icon: Icon(FeatherIcons.x, color: t.textTertiary), onPressed: () => Navigator.pop(ctx))
                 ],
               ),
               const SizedBox(height: 24),
               Expanded(
                 child: ListView(
                   children: [
                     _buildDetailSection("Summary", r.summary ?? "No summary available.", t),
                     const SizedBox(height: 24),
                     _buildDetailSection("Core Skills", "", t, 
                       content: Wrap(
                         spacing: 8, runSpacing: 8,
                         children: r.skills.map((s) => _buildPill(s, t)).toList()
                       )
                     ),
                   ],
                 ),
               )
            ],
          ),
        );
      }
    );
  }

  Widget _buildDetailSection(String title, String body, AppThemeColors t, {Widget? content}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: t.primary, letterSpacing: 1)),
        const SizedBox(height: 12),
        if (content != null) content
        else Text(body, style: TextStyle(fontSize: 15, color: t.textSecondary, height: 1.6)),
      ],
    );
  }

  Widget _buildPill(String text, AppThemeColors t) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(color: t.bgSecondary, borderRadius: BorderRadius.circular(12), border: Border.all(color: t.border.withOpacity(0.5))),
      child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: t.textSecondary)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final topPadding = MediaQuery.of(context).padding.top;

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: GestureDetector(
          onTap: _isUploading ? null : _handleUpload,
          child: GlassCard(
            borderRadius: 30,
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            hasMetallicBorder: true,
            hasGlow: true,
            tintColor: t.primary,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_isUploading) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                else const Icon(FeatherIcons.plus, color: Colors.white, size: 20),
                const SizedBox(width: 12),
                Text(_isUploading ? "Analysing..." : "Upload New", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
          ),
        ),
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // HEADER
            Padding(
              padding: EdgeInsets.only(top: topPadding + 16, left: 24, right: 24, bottom: 24),
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => Navigator.pop(context),
                    child: SizedBox(
                      width: 44, height: 44,
                      child: GlassCard(
                        borderRadius: 12,
                        padding: EdgeInsets.zero,
                        hasMetallicBorder: true,
                        child: Center(child: Icon(FeatherIcons.chevronLeft, color: t.text, size: 20)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          "Management Console",
                          style: TextStyle(
                            fontSize: 14,
                            color: t.textTertiary,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1.0,
                          ),
                        ),
                        Text(
                          "Resumes",
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
            
            // LIST CONTENT
            Expanded(
              child: mockResumes.isEmpty 
                ? Center(child: Text("No resumes uploaded.\nUse the action button to add one.", textAlign: TextAlign.center, style: TextStyle(color: t.textTertiary, fontSize: 16)))
                : ListView.builder(
                    padding: const EdgeInsets.only(top: 0, bottom: 100, left: 24, right: 24),
                    itemCount: mockResumes.length,
                    itemBuilder: (context, index) {
                      final resume = mockResumes[index];
                      return GestureDetector(
                        onTap: () => _showParsedPreview(resume),
                        child: GlassCard(
                          margin: const EdgeInsets.only(bottom: 16),
                          padding: const EdgeInsets.all(20),
                          hasMetallicBorder: true,
                          child: Row(
                            children: [
                              Container(
                                width: 50, height: 50,
                                decoration: BoxDecoration(color: t.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(14)),
                                child: Icon(FeatherIcons.fileText, color: t.primary, size: 20),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(resume.filename, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: t.text)),
                                    const SizedBox(height: 4),
                                    Text("${resume.fileSize} • Professional PDF", style: TextStyle(fontSize: 12, color: t.textSecondary)),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: Icon(FeatherIcons.trash2, color: t.error.withOpacity(0.6), size: 18),
                                onPressed: () => _handleDelete(index),
                              )
                            ],
                          ),
                        ),
                      );
                    },
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
