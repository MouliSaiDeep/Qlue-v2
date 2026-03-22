import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import '../core/theme.dart';
import '../core/mock_data.dart';
import '../screens/interview/interview_session_screen.dart';

class ResumeCard extends StatefulWidget {
  final Resume resume;
  final VoidCallback onDelete;
  final VoidCallback? onPress;
  const ResumeCard({super.key, required this.resume, required this.onDelete, this.onPress});
  @override
  State<ResumeCard> createState() => _ResumeCardState();
}

class _ResumeCardState extends State<ResumeCard> with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(vsync: this, duration: const Duration(milliseconds: 100));
    _scaleAnim = Tween<double>(begin: 1.0, end: 0.97).animate(CurvedAnimation(parent: _animController, curve: Curves.easeInOut));
  }

  @override
  void dispose() { _animController.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    bool isParsed = widget.resume.status == "parsed";
    bool isParsing = widget.resume.status == "parsing";
    bool isFailed = widget.resume.status == "failed";
    Color headerColor = widget.resume.format == "pdf" ? const Color(0xFFEF4444) : const Color(0xFF3B82F6);

    return GestureDetector(
      onTapDown: (_) => _animController.forward(),
      onTapUp: (_) { 
        _animController.reverse(); 
        if (widget.onPress != null) widget.onPress!();
      },
      onTapCancel: () => _animController.reverse(),
      child: AnimatedBuilder(
        animation: _scaleAnim,
        builder: (context, child) => Transform.scale(scale: _scaleAnim.value, child: child),
        child: Container(
          margin: const EdgeInsets.only(bottom: 14),
          decoration: BoxDecoration(
            color: t.card, borderRadius: BorderRadius.circular(20), border: Border.all(color: t.border),
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.1), offset: const Offset(0, 4), blurRadius: 16)],
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            // Header strip
            Container(
              decoration: BoxDecoration(gradient: LinearGradient(colors: [headerColor, headerColor.withValues(alpha: 0.73)])),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                Row(children: [
                  const Icon(FeatherIcons.fileText, size: 18, color: Colors.white),
                  const SizedBox(width: 10),
                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(widget.resume.format.toUpperCase(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.white)),
                    const SizedBox(height: 1),
                    Text(widget.resume.fileSize, style: TextStyle(fontSize: 11, color: Colors.white.withValues(alpha: 0.7))),
                  ]),
                ]),
                if (isParsed) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(20)),
                  child: const Row(children: [Icon(FeatherIcons.checkCircle, size: 12, color: Colors.white), SizedBox(width: 5), Text("Ready", style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white))]),
                ),
                if (isParsing) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: const Color(0xFFF59E0B).withValues(alpha: 0.25), borderRadius: BorderRadius.circular(20)),
                  child: const Row(children: [SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation<Color>(Colors.white))), SizedBox(width: 5), Text("Parsing", style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white))]),
                ),
                if (isFailed) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: const Color(0xFFEF4444).withValues(alpha: 0.25), borderRadius: BorderRadius.circular(20)),
                  child: const Row(children: [Icon(FeatherIcons.xCircle, size: 12, color: Colors.white), SizedBox(width: 5), Text("Failed", style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white))]),
                ),
              ]),
            ),
            // Body
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(widget.resume.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: t.text)),
                const SizedBox(height: 4),
                Text("Uploaded ${widget.resume.uploadDate}", style: TextStyle(fontSize: 12, color: t.textTertiary)),
                if (isParsed && widget.resume.skills.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6.0),
                    child: Wrap(spacing: 6.0, runSpacing: 6.0, children: [
                      ...widget.resume.skills.take(3).map((sk) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                        decoration: BoxDecoration(color: t.primaryMuted, borderRadius: BorderRadius.circular(20)),
                        child: Text(sk, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: t.primary)),
                      )),
                      if (widget.resume.skills.length > 3) Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                        decoration: BoxDecoration(color: t.bgSecondary, borderRadius: BorderRadius.circular(20)),
                        child: Text("+${widget.resume.skills.length - 3}", style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: t.textTertiary)),
                      ),
                    ]),
                  ),
              ]),
            ),
            // Actions
            Container(
              decoration: BoxDecoration(border: Border(top: BorderSide(color: t.borderSubtle))),
              padding: const EdgeInsets.all(12),
              child: Row(children: [
                if (isParsed) Expanded(
                  child: Material(color: t.moduleResume, borderRadius: BorderRadius.circular(11), child: InkWell(
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (context) => const InterviewSessionScreen())), borderRadius: BorderRadius.circular(11),
                    child: const SizedBox(height: 38, child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(FeatherIcons.mic, size: 14, color: Colors.white), SizedBox(width: 7), Text("Start Interview", style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.white))])),
                  )),
                ) else const Spacer(),
                const SizedBox(width: 10),
                Material(color: t.errorMuted, borderRadius: BorderRadius.circular(11), child: InkWell(
                  onTap: widget.onDelete, borderRadius: BorderRadius.circular(11),
                  child: SizedBox(width: 38, height: 38, child: Center(child: Icon(FeatherIcons.trash2, size: 15, color: t.error))),
                )),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
