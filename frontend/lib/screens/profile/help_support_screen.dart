import 'package:flutter/material.dart';
import '../../core/notifications.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../core/theme.dart';
import '../../components/glass_card.dart';
import '../../components/spectral_background.dart';

class HelpSupportScreen extends StatefulWidget {
  const HelpSupportScreen({super.key});

  @override
  State<HelpSupportScreen> createState() => _HelpSupportScreenState();
}

class _HelpSupportScreenState extends State<HelpSupportScreen> {
  final List<Map<String, String>> faqs = [
    {
      "q": "How do AI interviews work?",
      "a": "Our AI analyzes your audio responses in real-time using advanced NLP models to evaluate your communication clarity, structural methodology (like STAR), and topic relevance."
    },
    {
      "q": "Can I practice with my own resume?",
      "a": "Yes! Navigate to the Resume tab, upload your PDF or DOCX file, and the AI will automatically extract your skills to generate personalized interview questions."
    },
    {
      "q": "Are my recordings saved?",
      "a": "All audio is processed securely and is never stored permanently on our servers. The transcripts and session analytics are kept locally for your review."
    },
    {
      "q": "How is my score calculated?",
      "a": "Your score aggregates several factors: keyword matching, speaking pace, usage of filler words, and how well you answer the specific prompt."
    },
  ];

  String _subject = '';
  String _message = '';
  bool _sending = false;

  void _sendMessage() async {
    if (_subject.trim().isEmpty || _message.trim().isEmpty) return;
    setState(() => _sending = true);
    await Future.delayed(const Duration(milliseconds: 1000));
    if (mounted) {
      setState(() {
        _sending = false;
        _subject = '';
        _message = '';
      });
      Notify.success(context, 'Message sent successfully. Support will contact you soon.');
      FocusScope.of(context).unfocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final topPadding = MediaQuery.of(context).padding.top;
    final bottomPadding = MediaQuery.of(context).padding.bottom;

    return SpectralBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Column(
          children: [
            // Header
            Container(
              padding: EdgeInsets.only(top: topPadding + 16, bottom: 20, left: 20, right: 20),
              child: Row(
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
                        child: Center(child: Icon(FeatherIcons.chevronLeft, size: 20, color: t.text)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Text("Help & Support", style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, letterSpacing: -0.5, color: t.text)),
                ],
              ),
            ),
            
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: bottomPadding + 40),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("Frequently Asked Questions", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: t.text)),
                    const SizedBox(height: 12),
                    ...faqs.map((faq) {
                      return Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(
                          color: t.card,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: t.border),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withOpacity(0.03), offset: const Offset(0, 2), blurRadius: 8),
                          ],
                        ),
                        child: ExpansionTile(
                          title: Text(faq["q"]!, style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: t.text)),
                          iconColor: t.primary,
                          collapsedIconColor: t.iconDefault,
                          childrenPadding: const EdgeInsets.only(left: 16, right: 16, bottom: 16),
                          children: [
                            Text(faq["a"]!, style: TextStyle(fontSize: 14, color: t.textSecondary, height: 1.5)),
                          ],
                        ),
                      );
                    }),
                    
                    const SizedBox(height: 24),
                    Text("Contact Us", style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: t.text)),
                    const SizedBox(height: 4),
                    Text("Can't find what you're looking for? Send us a message.", style: TextStyle(fontSize: 14, color: t.textSecondary)),
                    const SizedBox(height: 16),
                    
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: t.card,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: t.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          TextField(
                            onChanged: (v) => _subject = v,
                            style: TextStyle(fontSize: 14, color: t.text),
                            decoration: InputDecoration(
                              labelText: "Subject",
                              labelStyle: TextStyle(color: t.textTertiary),
                              filled: true,
                              fillColor: t.bgSecondary,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            onChanged: (v) => _message = v,
                            maxLines: 5,
                            style: TextStyle(fontSize: 14, color: t.text),
                            decoration: InputDecoration(
                              labelText: "How can we help you?",
                              labelStyle: TextStyle(color: t.textTertiary),
                              filled: true,
                              fillColor: t.bgSecondary,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                            ),
                          ),
                          const SizedBox(height: 16),
                          ElevatedButton(
                            onPressed: _sending ? null : _sendMessage,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF2563EB), foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                              elevation: 0,
                            ),
                            child: _sending
                                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                                : const Text('Send Message', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
