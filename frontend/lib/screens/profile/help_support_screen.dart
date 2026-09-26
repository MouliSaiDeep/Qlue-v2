import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../core/notifications.dart';
import '../../core/theme.dart';
import '../../components/glass_controls.dart';
import '../../components/glass_card.dart';
import '../../components/spectral_background.dart';

/// A single frequently-asked-question entry.
class _Faq {
  final IconData icon;
  final String question;
  final String answer;
  const _Faq({required this.icon, required this.question, required this.answer});
}

class HelpSupportScreen extends StatefulWidget {
  const HelpSupportScreen({super.key});

  @override
  State<HelpSupportScreen> createState() => _HelpSupportScreenState();
}

class _HelpSupportScreenState extends State<HelpSupportScreen> {
  static const List<_Faq> _faqs = [
    _Faq(
      icon: FeatherIcons.cpu,
      question: "How do AI interviews work?",
      answer:
          "Our AI listens to your spoken answers in real time and evaluates your communication clarity, structure (such as the STAR method) and how relevant each response is to the question.",
    ),
    _Faq(
      icon: FeatherIcons.fileText,
      question: "Can I practice with my own resume?",
      answer:
          "Yes. Open the Resume module, upload your PDF or DOCX, and the AI extracts your skills and experience to ask personalized questions.",
    ),
    _Faq(
      icon: FeatherIcons.mic,
      question: "Can I change the interviewer's voice?",
      answer:
          "Yes. In Profile you can switch between the standard cost-saver voice and the premium natural voice for the AI interviewer.",
    ),
    _Faq(
      icon: FeatherIcons.lock,
      question: "Are my recordings saved?",
      answer:
          "Your audio is processed securely and is never stored permanently on our servers. Only transcripts and session analytics are kept so you can review your progress.",
    ),
    _Faq(
      icon: FeatherIcons.barChart2,
      question: "How is my score calculated?",
      answer:
          "Your score combines several signals: relevance to the prompt, speaking pace, use of filler words and answer structure. You can see the breakdown per dimension on the Performance radar.",
    ),
    _Faq(
      icon: FeatherIcons.download,
      question: "How do I update the app?",
      answer:
          "Open Profile and tap \"Check for updates\". If a newer version is available you can download and install it right from there.",
    ),
  ];

  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _subjectController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();

  String _query = '';
  String? _openQuestion;
  bool _sending = false;

  @override
  void dispose() {
    _searchController.dispose();
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  List<_Faq> get _filteredFaqs {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return _faqs;
    return _faqs
        .where((f) =>
            f.question.toLowerCase().contains(q) ||
            f.answer.toLowerCase().contains(q))
        .toList();
  }
  Future<void> _sendMessage() async {
    if (_subjectController.text.trim().isEmpty ||
        _messageController.text.trim().isEmpty) {
      Notify.error(context, 'Please add a subject and a message first.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _sending = true);
    await Future.delayed(const Duration(milliseconds: 1000));
    if (!mounted) return;
    setState(() {
      _sending = false;
      _subjectController.clear();
      _messageController.clear();
    });
    Notify.success(
        context, 'Message sent successfully. Support will contact you soon.');
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final topPadding = MediaQuery.of(context).padding.top;
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    final faqs = _filteredFaqs;

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Column(
          children: [
            _buildHeader(t, topPadding),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.only(
                    left: 16, right: 16, top: 4, bottom: bottomPadding + 40),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildHero(t),
                    const SizedBox(height: 20),
                    _buildSearchField(t),
                    const SizedBox(height: 20),
                    _buildSectionLabel(
                        t, "Frequently asked questions", FeatherIcons.helpCircle),
                    const SizedBox(height: 12),
                    if (faqs.isEmpty)
                      _buildNoResults(t)
                    else
                      ...faqs.map((f) => _buildFaqItem(t, f)),
                    const SizedBox(height: 28),
                    _buildSectionLabel(
                        t, "Still need help?", FeatherIcons.messageSquare),
                    const SizedBox(height: 12),
                    _buildContactCard(t),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
  Widget _buildHeader(AppThemeColors t, double topPadding) {
    return Container(
      padding:
          EdgeInsets.only(top: topPadding + 16, bottom: 12, left: 20, right: 20),
      child: Row(
        children: [
          AppIconButton(
            icon: FeatherIcons.chevronLeft,
            onTap: () => Navigator.of(context).pop(),
            background: true,
            borderRadius: 12,
            color: t.text,
          ),
          const SizedBox(width: 16),
          Text(
            "Help & Support",
            style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                letterSpacing: -0.5,
                color: t.text),
          ),
        ],
      ),
    );
  }

  Widget _buildHero(AppThemeColors t) {
    return GlassCard(
      hasMetallicBorder: true,
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: t.primary.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(FeatherIcons.lifeBuoy, color: t.primary, size: 26),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "How can we help?",
                  style: TextStyle(
                      fontSize: 17, fontWeight: FontWeight.bold, color: t.text),
                ),
                const SizedBox(height: 4),
                Text(
                  "Search our FAQs or send us a message. We usually reply within 24 hours.",
                  style: TextStyle(
                      fontSize: 13, color: t.textSecondary, height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
  Widget _buildSearchField(AppThemeColors t) {
    return Container(
      decoration: BoxDecoration(
        color: t.bgSecondary,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: t.border),
      ),
      child: Row(
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 14, right: 8),
            child: Icon(FeatherIcons.search, size: 18, color: t.textTertiary),
          ),
          Expanded(
            child: TextField(
              controller: _searchController,
              onChanged: (v) => setState(() => _query = v),
              style: TextStyle(fontSize: 14, color: t.text),
              decoration: InputDecoration(
                border: InputBorder.none,
                isDense: true,
                hintText: "Search for help",
                hintStyle: TextStyle(color: t.placeholder, fontSize: 14),
                contentPadding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ),
          if (_query.isNotEmpty)
            AppIconButton(
              icon: FeatherIcons.x,
              onTap: () {
                _searchController.clear();
                setState(() => _query = '');
                FocusScope.of(context).unfocus();
              },
              size: 40,
              iconSize: 16,
              color: t.textTertiary,
            ),
        ],
      ),
    );
  }

  Widget _buildSectionLabel(AppThemeColors t, String text, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 18, color: t.primary),
        const SizedBox(width: 8),
        Text(
          text,
          style: TextStyle(
              fontSize: 17, fontWeight: FontWeight.bold, color: t.text),
        ),
      ],
    );
  }
  Widget _buildFaqItem(AppThemeColors t, _Faq faq) {
    final isOpen = _openQuestion == faq.question;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: GlassCard(
        padding: const EdgeInsets.all(16),
        borderRadius: 16,
        onTap: () =>
            setState(() => _openQuestion = isOpen ? null : faq.question),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: t.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(faq.icon, size: 18, color: t.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    faq.question,
                    style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: t.text,
                        height: 1.3),
                  ),
                ),
                const SizedBox(width: 8),
                AnimatedRotation(
                  turns: isOpen ? 0.5 : 0,
                  duration: const Duration(milliseconds: 220),
                  child: Icon(FeatherIcons.chevronDown,
                      size: 20, color: t.textTertiary),
                ),
              ],
            ),
            AnimatedCrossFade(
              firstChild: const SizedBox(width: double.infinity, height: 0),
              secondChild: Padding(
                padding: const EdgeInsets.only(top: 12, left: 48),
                child: Text(
                  faq.answer,
                  style: TextStyle(
                      fontSize: 13.5, color: t.textSecondary, height: 1.5),
                ),
              ),
              crossFadeState: isOpen
                  ? CrossFadeState.showSecond
                  : CrossFadeState.showFirst,
              duration: const Duration(milliseconds: 220),
            ),
          ],
        ),
      ),
    );
  }
  Widget _buildNoResults(AppThemeColors t) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Center(
        child: Column(
          children: [
            Icon(FeatherIcons.search, size: 32, color: t.textTertiary),
            const SizedBox(height: 12),
            Text(
              "No results for \"$_query\"",
              style: TextStyle(
                  fontSize: 14, fontWeight: FontWeight.w600, color: t.text),
            ),
            const SizedBox(height: 4),
            Text(
              "Try a different search, or send us a message below.",
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: t.textSecondary),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContactCard(AppThemeColors t) {
    return GlassCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildContactField(
            t,
            label: "Subject",
            controller: _subjectController,
            hint: "What do you need help with?",
          ),
          const SizedBox(height: 14),
          _buildContactField(
            t,
            label: "Message",
            controller: _messageController,
            hint: "Describe your issue or question…",
            maxLines: 5,
          ),
          const SizedBox(height: 16),
          AppButton(
            onTap: _sending ? null : _sendMessage,
            icon: _sending ? null : FeatherIcons.send,
            label: _sending ? null : "Send message",
            child: _sending
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                        color: Colors.white, strokeWidth: 2),
                  )
                : null,
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(FeatherIcons.clock, size: 13, color: t.textTertiary),
              const SizedBox(width: 6),
              Text(
                "Typical response time: within 24 hours",
                style: TextStyle(fontSize: 12, color: t.textTertiary),
              ),
            ],
          ),
        ],
      ),
    );
  }
  Widget _buildContactField(
    AppThemeColors t, {
    required String label,
    required TextEditingController controller,
    required String hint,
    int maxLines = 1,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: t.textSecondary,
              letterSpacing: 0.3),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          maxLines: maxLines,
          style: TextStyle(fontSize: 14, color: t.text),
          decoration: InputDecoration(
            filled: true,
            fillColor: t.bgSecondary,
            hintText: hint,
            hintStyle: TextStyle(color: t.placeholder, fontSize: 14),
            border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          ),
        ),
      ],
    );
  }
}
