import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme.dart';
import '../../core/models/resume_model.dart';
import '../../context/resume_provider.dart';
import '../../components/glass_card.dart';
import '../../components/semi_circle_gauge.dart';
import '../../components/spectral_background.dart';
import '../../core/network/dio_client.dart';
import '../../core/notifications.dart';
import '../../core/constants/api_constants.dart';

/// Dedicated Job Match flow: provide a job posting (link or pasted text),
/// pick a resume, analyze, and see the profile match as a semicircle gauge.
/// A score at or above the threshold unlocks a JD-tailored practice
/// interview; below it, the screen explains the gap instead.
class JobMatchScreen extends StatefulWidget {
  const JobMatchScreen({super.key});

  @override
  State<JobMatchScreen> createState() => _JobMatchScreenState();
}

class _JobMatchScreenState extends State<JobMatchScreen> {
  final TextEditingController _urlController = TextEditingController();
  final TextEditingController _pasteController = TextEditingController();
  bool _usePastedText = false;
  ResumeModel? _selectedResume;
  bool _analyzing = false;
  Map<String, dynamic>? _result;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final rp = context.read<ResumeProvider>();
      rp.fetchResumes().then((_) {
        if (mounted && rp.resumes.isNotEmpty) {
          setState(() => _selectedResume = rp.activeResume ?? rp.resumes.first);
        }
      });
    });
  }

  @override
  void dispose() {
    _urlController.dispose();
    _pasteController.dispose();
    super.dispose();
  }

  Future<void> _analyze() async {
    if (_selectedResume == null) {
      Notify.error(context, "Select a resume first.");
      return;
    }
    final Map<String, dynamic> body = {'resumeId': _selectedResume!.resumeId};
    if (_usePastedText) {
      final text = _pasteController.text.trim();
      if (text.length < 100) {
        Notify.error(context, "Paste the full job description (at least 100 characters).");
        return;
      }
      body['jobText'] = text;
    } else {
      final url = _urlController.text.trim();
      final uri = Uri.tryParse(url);
      if (url.isEmpty || uri == null || !uri.hasScheme || !uri.hasAuthority) {
        Notify.error(context, "Enter a valid job posting link.");
        return;
      }
      body['jobUrl'] = url;
    }

    setState(() {
      _analyzing = true;
      _result = null;
    });
    try {
      final response = await DioClient().dio.post(ApiConstants.jdAnalyze, data: body);
      final result = (response.data is Map && response.data['data'] is Map)
          ? response.data['data']
          : response.data;

      if (result['analyzed'] != true) {
        if (!mounted) return;
        if (result['canPasteText'] == true && !_usePastedText) {
          setState(() => _usePastedText = true);
          Notify.error(context,
              result['reason'] ?? "This site blocks automated reading — paste the description instead.");
        } else {
          Notify.error(context, result['reason'] ?? "Could not analyze this job posting.");
        }
        return;
      }
      if (mounted) setState(() => _result = Map<String, dynamic>.from(result));
    } catch (e) {
      if (mounted) Notify.error(context, "Network error during job match analysis.");
    } finally {
      if (mounted) setState(() => _analyzing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final resumes = context.watch<ResumeProvider>().resumes;

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          leading: IconButton(
            icon: Icon(FeatherIcons.arrowLeft, color: t.text, size: 20),
            onPressed: () => context.pop(),
          ),
          title: Text("Job Match",
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: t.text)),
          centerTitle: true,
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 40),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ---------------- INPUT CARD ----------------
              GlassCard(
                hasMetallicBorder: true,
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: _sourceToggle(t, "Job Link", !_usePastedText,
                              () => setState(() => _usePastedText = false)),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _sourceToggle(t, "Paste JD", _usePastedText,
                              () => setState(() => _usePastedText = true)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    if (!_usePastedText)
                      TextField(
                        controller: _urlController,
                        style: TextStyle(color: t.text, fontSize: 13),
                        decoration: _inputDecoration(
                            t, "https://company.com/careers/job-id", FeatherIcons.link),
                      )
                    else
                      TextField(
                        controller: _pasteController,
                        maxLines: 6,
                        style: TextStyle(color: t.text, fontSize: 13),
                        decoration: _inputDecoration(
                            t, "Paste the full job description here...", FeatherIcons.clipboard),
                      ),
                    const SizedBox(height: 14),
                    Text("RESUME",
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 1,
                            color: t.textTertiary)),
                    const SizedBox(height: 8),
                    if (resumes.isEmpty)
                      GestureDetector(
                        onTap: () => context.push('/resume/upload'),
                        child: Text("No resumes yet — tap to upload one",
                            style: TextStyle(fontSize: 13, color: t.primary)),
                      )
                    else
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: resumes.map((r) {
                          final selected = _selectedResume?.resumeId == r.resumeId;
                          return GestureDetector(
                            onTap: () => setState(() => _selectedResume = r),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: selected
                                    ? t.primary.withValues(alpha: 0.18)
                                    : t.bg.withValues(alpha: 0.4),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                    color: selected
                                        ? t.primary
                                        : t.metallicBorder.withValues(alpha: 0.3)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(FeatherIcons.fileText,
                                      size: 12, color: selected ? t.primary : t.textTertiary),
                                  const SizedBox(width: 6),
                                  ConstrainedBox(
                                    constraints: const BoxConstraints(maxWidth: 160),
                                    child: Text(
                                      r.fileName,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                          fontSize: 12,
                                          color: selected ? t.primary : t.textSecondary),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: GestureDetector(
                        onTap: _analyzing ? null : _analyze,
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(colors: t.primaryGradient),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Center(
                            child: _analyzing
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white))
                                : const Text("Analyze Match",
                                    style: TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white)),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // ---------------- RESULT ----------------
              if (_result != null) ...[
                const SizedBox(height: 20),
                _buildResult(t, _result!),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildResult(AppThemeColors t, Map<String, dynamic> r) {
    final int score = (r['matchScore'] as num?)?.toInt() ?? 0;
    final int threshold = (r['threshold'] as num?)?.toInt() ?? 60;
    final bool eligible = r['eligible'] == true;
    final String roleTitle = r['roleTitle'] ?? 'Unknown Role';
    final List matched = (r['matchedSkills'] as List?) ?? [];
    final List missing = (r['missingSkills'] as List?) ?? [];
    final String verdict = r['verdict'] ?? '';
    final Color scoreColor = score >= 75
        ? const Color(0xFF4ADE80) // light green
        : (score >= 50
            ? const Color(0xFFFBBF24) // mustard
            : const Color(0xFFF87171)); // red

    return GlassCard(
      hasMetallicBorder: true,
      glowColor: scoreColor,
      glowRadius: 40,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: SemiCircleGauge(
              progress: score / 100.0,
              color: scoreColor,
              trackColor: t.metallicBorder.withValues(alpha: 0.25),
              width: 200,
              center: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text("$score%",
                      style: TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.w900,
                          color: scoreColor)),
                  Text("Profile Match",
                      style: TextStyle(fontSize: 11, color: t.textTertiary)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: Text(roleTitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
          ),
          if (verdict.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(verdict,
                style: TextStyle(fontSize: 12.5, color: t.textSecondary, height: 1.4)),
          ],
          const SizedBox(height: 14),
          if (matched.isNotEmpty) ...[
            _skillHeader(t, "YOU MATCH", t.accentGreen),
            const SizedBox(height: 6),
            ...matched.map((m) => _skillRow(t, "$m", FeatherIcons.check, t.accentGreen)),
            const SizedBox(height: 10),
          ],
          if (missing.isNotEmpty) ...[
            _skillHeader(t, "GAPS TO PREPARE FOR", Colors.orangeAccent),
            const SizedBox(height: 6),
            ...missing.map(
                (m) => _skillRow(t, "$m", FeatherIcons.alertCircle, Colors.orangeAccent)),
            const SizedBox(height: 10),
          ],
          const SizedBox(height: 6),
          if (eligible)
            SizedBox(
              width: double.infinity,
              child: GestureDetector(
                onTap: () => context.push(
                    '/interview/session/new?moduleType=JD&resumeId=${_selectedResume!.resumeId}'),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: t.primaryGradient),
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [
                      BoxShadow(
                          color: t.primaryGradient.last.withValues(alpha: 0.35),
                          blurRadius: 18,
                          offset: const Offset(0, 6)),
                    ],
                  ),
                  child: const Center(
                    child: Text("Start Practice Interview",
                        style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Colors.white)),
                  ),
                ),
              ),
            )
          else
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.orangeAccent.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.orangeAccent.withValues(alpha: 0.35)),
              ),
              child: Text(
                "This job doesn't match your profile yet — you need $threshold% or more to unlock a tailored practice interview. Strengthen the gaps above or try a closer-fitting role.",
                style: TextStyle(fontSize: 12.5, color: t.textSecondary, height: 1.45),
              ),
            ),
        ],
      ),
    );
  }

  Widget _sourceToggle(AppThemeColors t, String label, bool active, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: active ? t.primary.withValues(alpha: 0.18) : t.bg.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
              color: active ? t.primary : t.metallicBorder.withValues(alpha: 0.3)),
        ),
        child: Center(
          child: Text(label,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  color: active ? t.primary : t.textSecondary)),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(AppThemeColors t, String hint, IconData icon) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: t.textTertiary, fontSize: 12.5),
      filled: true,
      fillColor: t.bg.withValues(alpha: 0.4),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide.none,
      ),
      contentPadding: const EdgeInsets.all(14),
      prefixIcon: Icon(icon, size: 14, color: t.primary),
    );
  }

  Widget _skillHeader(AppThemeColors t, String text, Color color) {
    return Text(text,
        style: TextStyle(
            fontSize: 11, fontWeight: FontWeight.bold, color: color, letterSpacing: 1));
  }

  Widget _skillRow(AppThemeColors t, String text, IconData icon, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 8),
          Expanded(
              child: Text(text, style: TextStyle(fontSize: 12.5, color: t.text))),
        ],
      ),
    );
  }
}
