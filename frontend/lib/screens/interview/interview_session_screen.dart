import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'dot_matrix_painter.dart';
import '../feedback/feedback_report_screen.dart';
import '../../core/theme.dart';
import '../../components/glass_card.dart';

const List<String> _questions = [
  "Tell me about yourself and your professional background.",
  "Describe a challenging project you worked on and how you handled it.",
  "What are your greatest strengths and how do they apply to this role?",
  "Where do you see yourself in five years?",
  "Tell me about a time you had to work under pressure.",
];

enum Phase { ready, speaking, listening, processing }

class InterviewSessionScreen extends StatefulWidget {
  final String interviewId;
  const InterviewSessionScreen({super.key, this.interviewId = "mock-id"});

  @override
  State<InterviewSessionScreen> createState() => _InterviewSessionScreenState();
}

class _InterviewSessionScreenState extends State<InterviewSessionScreen> with TickerProviderStateMixin {
  Phase phase = Phase.ready;
  int currentQ = 0;
  
  late AnimationController _animationController;
  late AnimationController _intensityController;
  
  double _time = 0;
  double _intensity = 0.0;
  
  Offset? _tapOffset;
  double _lastTapTime = 0;

  @override
  void initState() {
    super.initState();
    
    _animationController = AnimationController(vsync: this, duration: const Duration(days: 1))
      ..addListener(() {
        if (!mounted) return;
        setState(() => _time += 0.016);
      });
    _animationController.repeat();

    _intensityController = AnimationController(vsync: this, duration: const Duration(milliseconds: 500))
      ..addListener(() {
        if (!mounted) return;
        setState(() => _intensity = _intensityController.value);
      });
    
    Future.delayed(const Duration(milliseconds: 1000), () => _startAiSpeaking());
  }

  void _handleTap(TapDownDetails details, BoxConstraints constraints) {
    // Calculate local position relative to the 360x360 box
    setState(() {
      _tapOffset = details.localPosition;
      _lastTapTime = _time;
    });
  }

  void _startAiSpeaking() {
    if (!mounted) return;
    setState(() => phase = Phase.speaking);
    _simulateIntensity();
    
    Future.delayed(const Duration(seconds: 5), () {
      if (mounted && phase == Phase.speaking) {
        _intensityController.animateTo(0, duration: const Duration(milliseconds: 600));
        setState(() => phase = Phase.listening);
        _simulateIntensity(); 
        _autoStopListening();
      }
    });
  }

  void _simulateIntensity() {
    if (!mounted) return;
    Future.doWhile(() async {
      if (!mounted || (phase != Phase.speaking && phase != Phase.listening)) return false;
      final target = 0.1 + math.Random().nextDouble() * (phase == Phase.speaking ? 0.4 : 0.8);
      if (mounted) {
        _intensityController.animateTo(target, duration: const Duration(milliseconds: 500), curve: Curves.easeInOut);
      }
      await Future.delayed(const Duration(milliseconds: 600));
      return true;
    });
  }

  void _autoStopListening() {
    Future.delayed(const Duration(seconds: 10), () {
      if (mounted && phase == Phase.listening) {
        _intensityController.animateTo(0, duration: const Duration(milliseconds: 800));
        setState(() => phase = Phase.processing);
        _finishProcessing();
      }
    });
  }

  void _finishProcessing() {
    Future.delayed(const Duration(seconds: 3), () {
      if (!mounted) return;
      if (currentQ + 1 >= _questions.length) {
        _endInterview();
      } else {
        setState(() {
          currentQ++;
          _startAiSpeaking();
        });
      }
    });
  }

  void _endInterview() => Navigator.pushReplacement(context, MaterialPageRoute(builder: (context) => const FeedbackReportScreen()));

  @override
  void dispose() {
    _animationController.dispose();
    _intensityController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    
    bool isAiSpeaking = (phase == Phase.speaking);
    bool isListening = (phase == Phase.listening);
    bool isProcessing = (phase == Phase.processing);

    // STATE-SPECIFIC CHROMATICS
    Color activeColor = t.primary; // Default AI (Green)
    if (isListening) activeColor = Colors.orangeAccent;
    if (isProcessing) activeColor = Colors.blueAccent;

    return Scaffold(
      backgroundColor: Colors.black, // Pure OLED Void
      body: Stack(
        children: [
          // 1. THE SPECTRAL CORE (Hero Element)
          Align(
            alignment: Alignment.center,
            child: SizedBox(
              width: 360,
              height: 360,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return GestureDetector(
                    onTapDown: (details) => _handleTap(details, constraints),
                    child: RepaintBoundary(
                      child: CustomPaint(
                        painter: AiDotMatrixPainter(
                          time: _time,
                          baseColor: activeColor,
                          intensity: _intensity,
                          isInwards: isListening,
                          tapOffset: _tapOffset,
                          tapTime: _lastTapTime,
                        ),
                      ),
                    ),
                  );
                }
              ),
            ),
          ),

          // 2. MINIMALIST OVERLAY
          SafeArea(
            child: Stack(
              children: [
                // TOP FOCUS: Typographic Question
                Align(
                  alignment: Alignment.topCenter,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 80, left: 48, right: 48),
                    child: AnimatedOpacity(
                      duration: const Duration(milliseconds: 1200),
                      opacity: (isAiSpeaking || isProcessing) ? 1.0 : 0.1,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text("System Prompt", 
                            style: TextStyle(fontSize: 9, fontFamily: 'monospace', fontWeight: FontWeight.w900, color: Colors.white.withOpacity(0.1), letterSpacing: 4)),
                          const SizedBox(height: 16),
                          Text(
                            _questions[currentQ],
                            style: const TextStyle(fontSize: 26, fontFamily: 'monospace', fontWeight: FontWeight.w700, color: Colors.white, height: 1.3, letterSpacing: -0.8),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // BOTTOM STATUS: Ghosted Pulse
                Align(
                  alignment: Alignment.bottomCenter,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 80),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          isProcessing ? "Neural Processing" : (isAiSpeaking ? "Signal Broadcast" : "Signal Capture"),
                          style: TextStyle(fontSize: 10, fontFamily: 'monospace', fontWeight: FontWeight.w900, color: activeColor.withOpacity(0.2), letterSpacing: 6),
                        ),
                        const SizedBox(height: 12),
                        Container(width: 40, height: 1, color: activeColor.withOpacity(0.1)),
                      ],
                    ),
                  ),
                ),

                // Floating Ghost Back
                Positioned(
                  top: 24, left: 24,
                  child: GestureDetector(
                    onTap: () => Navigator.pop(context),
                    child: SizedBox(
                      width: 44,
                      height: 44,
                      child: GlassCard(
                        borderRadius: 12,
                        padding: EdgeInsets.zero,
                        hasMetallicBorder: true,
                        child: Center(child: Icon(FeatherIcons.chevronLeft, color: Colors.white, size: 20)),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
