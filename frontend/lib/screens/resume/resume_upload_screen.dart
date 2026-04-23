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
import 'resume_detail_screen.dart';

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
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (context) => ResumeDetailScreen(resumeId: resume.resumeId),
                            ),
                          );
                        },
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
