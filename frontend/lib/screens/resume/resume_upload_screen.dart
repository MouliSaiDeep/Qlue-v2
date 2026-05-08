import 'package:flutter/material.dart';
import '../../core/notifications.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:file_picker/file_picker.dart';

import 'package:flutter/foundation.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../core/models/resume_model.dart';
import '../../context/resume_provider.dart';
import '../../components/glass_card.dart';
import '../../components/spectral_background.dart';
import '../../components/confirmation_dialog.dart';

class ResumeUploadScreen extends StatefulWidget {
  const ResumeUploadScreen({super.key});

  @override
  State<ResumeUploadScreen> createState() => _ResumeUploadScreenState();
}

class _ResumeUploadScreenState extends State<ResumeUploadScreen> {
  bool _isUploading = false;

  void _handleUpload() async {
    final provider = context.read<ResumeProvider>();
    if (provider.resumes.length >= provider.maxAllowed) {
      Notify.error(context, "Maximum of ${provider.maxAllowed} resumes allowed.");
      return;
    }

    FilePickerResult? result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      withData: true,
    );

    if (result != null) {
      final fileData = result.files.single;
      final fileName = fileData.name;
      
      setState(() => _isUploading = true);
      
      bool success;
      if (kIsWeb) {
        if (fileData.bytes != null) {
          success = await provider.uploadResume(fileData.bytes!, fileName);
        } else {
          Notify.error(context, "Could not read file data.");
          setState(() => _isUploading = false);
          return;
        }
      } else {
        // Mobile/Desktop
        final path = fileData.path;
        if (path != null) {
          success = await provider.uploadResume(path, fileName);
        } else if (fileData.bytes != null) {
          success = await provider.uploadResume(fileData.bytes!, fileName);
        } else {
          Notify.error(context, "Could not find file data or path.");
          setState(() => _isUploading = false);
          return;
        }
      }
      
      if (!mounted) return;
      setState(() {
        _isUploading = false;
      });

      if (success) {
        Notify.success(context, "Resume uploaded and processing started.");
      } else {
        if (provider.error != null) {
          Notify.error(context, provider.error!);
        } else {
          Notify.error(context, "Failed to upload resume.");
        }
      }
    }
  }

  void _handleDelete(String resumeId) async {
    final confirmed = await ConfirmationDialog.show(
      context,
      title: "Delete Resume?",
      message: "This will permanently remove your document.",
      confirmLabel: "Delete",
      confirmColor: AppThemeColors.of(context).error,
      icon: FeatherIcons.trash2,
    );

    if (confirmed == true && mounted) {
      context.read<ResumeProvider>().deleteResume(resumeId);
    }
  }

  void _showParsedPreview(ResumeModel r) {
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
               Container(width: 40, height: 4, decoration: BoxDecoration(color: t.border.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(2))),
               const SizedBox(height: 24),
               Row(
                 children: [
                   Container(
                     padding: const EdgeInsets.all(12),
                     decoration: BoxDecoration(color: t.primary.withValues(alpha: 0.1), shape: BoxShape.circle),
                     child: Icon(FeatherIcons.fileText, color: t.primary, size: 24),
                   ),
                   const SizedBox(width: 16),
                   Expanded(
                     child: Column(
                       crossAxisAlignment: CrossAxisAlignment.start,
                       children: [
                         Text("Resume Profile", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: t.text)),
                         Text(r.fileName, style: TextStyle(fontSize: 14, color: t.textSecondary)),
                       ],
                     )
                   ),
                   IconButton(icon: Icon(FeatherIcons.x, color: t.textTertiary), onPressed: () => Navigator.pop(ctx))
                 ],
               ),
               const SizedBox(height: 24),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.only(bottom: 24),
                    children: [
                      if (r.parsedData?.name != null)
                        _buildDetailSection("Candidate Name", r.parsedData!.name!, t),
                      
                      if (r.parsedData?.skills != null && r.parsedData!.skills!.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        _buildDetailSection("Skills & Technologies", "", t, 
                          content: Wrap(
                            spacing: 8, runSpacing: 8,
                            children: r.parsedData!.skills!.map((s) => _buildPill(s, t)).toList()
                          )
                        ),
                      ],

                      if (r.parsedData?.workExperience != null && r.parsedData!.workExperience!.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        _buildDetailSection("Work Experience", "", t,
                          content: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: r.parsedData!.workExperience!.map((exp) => Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(exp.role ?? "Role", style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                  Text(exp.company ?? "Company", style: TextStyle(fontSize: 12, color: t.primary)),
                                  if (exp.duration != null)
                                    Text(exp.duration!, style: TextStyle(fontSize: 11, color: t.textTertiary)),
                                ],
                              ),
                            )).toList(),
                          )
                        ),
                      ],

                      if (r.parsedData?.projects != null && r.parsedData!.projects!.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        _buildDetailSection("Key Projects", "", t,
                          content: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: r.parsedData!.projects!.map((proj) => Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(proj.name ?? "Project", style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                  if (proj.description != null)
                                    Text(proj.description!, style: TextStyle(fontSize: 12, color: t.textSecondary)),
                                ],
                              ),
                            )).toList(),
                          )
                        ),
                      ],

                      if (r.parsedData?.education != null && r.parsedData!.education!.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        _buildDetailSection("Education", "", t,
                          content: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: r.parsedData!.education!.map((edu) => Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(edu.degree ?? "Degree", style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                                  Text(edu.institution ?? "Institution", style: TextStyle(fontSize: 12, color: t.textSecondary)),
                                ],
                              ),
                            )).toList(),
                          )
                        ),
                      ],
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
      decoration: BoxDecoration(color: t.bgSecondary, borderRadius: BorderRadius.circular(12), border: Border.all(color: t.border.withValues(alpha: 0.5))),
      child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: t.textSecondary)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final topPadding = MediaQuery.of(context).padding.top;

    final provider = context.watch<ResumeProvider>();
    final resumes = provider.resumes;

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
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(FeatherIcons.plus, color: Colors.white, size: 20),
                SizedBox(width: 12),
                Text("Upload New", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
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
              child: provider.isLoading && resumes.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    padding: const EdgeInsets.only(top: 0, bottom: 100, left: 24, right: 24),
                    itemCount: (resumes.isEmpty && !_isUploading) ? 1 : resumes.length + (_isUploading ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (resumes.isEmpty && !_isUploading) {
                        return Padding(
                          padding: const EdgeInsets.only(top: 100),
                          child: Center(child: Text("No resumes uploaded.\nUse the action button to add one.", textAlign: TextAlign.center, style: TextStyle(color: t.textTertiary, fontSize: 16))),
                        );
                      }

                      // Show "Analyzing" card as the first item if uploading
                      if (_isUploading && index == 0) {
                        return GlassCard(
                          margin: const EdgeInsets.only(bottom: 16),
                          padding: const EdgeInsets.all(20),
                          hasMetallicBorder: true,
                          hasGlow: true,
                          tintColor: t.primary,
                          child: Row(
                            children: [
                              Container(
                                width: 50, height: 50,
                                decoration: BoxDecoration(color: t.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(14)),
                                child: const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text("Analyzing Resume...", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: t.text)),
                                    const SizedBox(height: 4),
                                    Text("Extracting information and generating profile", style: TextStyle(fontSize: 12, color: t.textSecondary)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        );
                      }

                      final resume = resumes[_isUploading ? index - 1 : index];
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
                                decoration: BoxDecoration(color: t.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(14)),
                                child: Icon(FeatherIcons.fileText, color: t.primary, size: 20),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(resume.fileName, style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: t.text)),
                                    const SizedBox(height: 4),
                                    Text("${(resume.fileSize / 1024 / 1024).toStringAsFixed(1)} MB • Professional PDF • ${resume.status.name.toUpperCase()}", style: TextStyle(fontSize: 12, color: t.textSecondary)),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: Icon(FeatherIcons.trash2, color: t.error.withValues(alpha: 0.6), size: 18),
                                onPressed: () => _handleDelete(resume.resumeId),
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
