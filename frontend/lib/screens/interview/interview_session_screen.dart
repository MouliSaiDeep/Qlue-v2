import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:go_router/go_router.dart';
import 'dot_matrix_painter.dart';
import '../../core/theme.dart';
import '../../components/glass_card.dart';
import '../../features/interview/providers/interview_provider.dart';
import 'package:provider/provider.dart';

class InterviewSessionScreen extends StatefulWidget {
  final String? interviewId;
  final String? resumeId;
  final String? websiteUrl;

  const InterviewSessionScreen({
    super.key, 
    this.interviewId,
    this.resumeId,
    this.websiteUrl,
  });

  @override
  State<InterviewSessionScreen> createState() => _InterviewSessionScreenState();
}

class _InterviewSessionScreenState extends State<InterviewSessionScreen> with TickerProviderStateMixin {
  
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

    // Initialize Real Session
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final type = widget.resumeId != null ? 'RESUME' : (widget.websiteUrl != null ? 'WEBSITE' : 'HR');
      context.read<InterviewProvider>().initSession(
        type, 
        resumeId: widget.resumeId,
        websiteUrl: widget.websiteUrl,
      );
    });
  }

  void _handleTap(TapDownDetails details, BoxConstraints constraints) {
    // Calculate local position relative to the 360x360 box
    setState(() {
      _tapOffset = details.localPosition;
      _lastTapTime = _time;
    });
  }

  bool _isSimulating = false;

  void _simulateIntensity(InterviewPhase phase) {
    if (_isSimulating || !mounted) return;
    _isSimulating = true;
    
    Future.doWhile(() async {
      if (!mounted || (phase != InterviewPhase.speaking && phase != InterviewPhase.listening)) {
        _isSimulating = false;
        return false;
      }
      final target = 0.1 + math.Random().nextDouble() * (phase == InterviewPhase.speaking ? 0.4 : 0.8);
      if (mounted) {
        _intensityController.animateTo(target, duration: const Duration(milliseconds: 500), curve: Curves.easeInOut);
      }
      await Future.delayed(const Duration(milliseconds: 600));
      return true;
    });
  }

  @override
  void dispose() {
    _animationController.dispose();
    _intensityController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.of(context);
    final provider = context.watch<InterviewProvider>();
    
    // Auto-End Navigation
    if (provider.isSessionEnded) {
       WidgetsBinding.instance.addPostFrameCallback((_) {
         if (mounted) context.pushReplacement('/feedback/${provider.sessionId}');
       });
    }

    final interviewPhase = provider.currentPhase;
    bool isAiSpeaking = interviewPhase == InterviewPhase.speaking;
    bool isListening = interviewPhase == InterviewPhase.listening;
    bool isProcessing = interviewPhase == InterviewPhase.processing;
    bool isConnecting = provider.isConnecting;

    // STATE-SPECIFIC CHROMATICS
    Color activeColor = t.primary; 
    if (isListening) activeColor = Colors.orangeAccent;
    if (isProcessing) activeColor = Colors.blueAccent;
    if (isConnecting) activeColor = Colors.white.withValues(alpha: 0.3);

    return Scaffold(
      backgroundColor: Colors.black, 
      body: Stack(
        children: [
          // 1. THE LAYOUT ENGINE
          SafeArea(
            child: Column(
              children: [
                // TOP: GHOST BACK BUTTON
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                  child: Row(
                    children: [
                      GestureDetector(
                        onTap: () => context.pop(),
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
                      const Spacer(),
                    ],
                  ),
                ),

                // AI SYSTEM BROADCAST (Scrollable)
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 40),
                    alignment: Alignment.bottomCenter,
                    child: SingleChildScrollView(
                      reverse: true, // Keep latest text visible
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(isConnecting ? "ESTABLISHING NEURAL LINK" : "SYSTEM BROADCAST", 
                            style: TextStyle(fontSize: 9, fontFamily: 'monospace', fontWeight: FontWeight.w900, color: Colors.white.withValues(alpha: 0.1), letterSpacing: 4)),
                          const SizedBox(height: 12),
                          Text(
                            isConnecting ? "Connecting..." : provider.questionText,
                            style: const TextStyle(fontSize: 18, fontFamily: 'monospace', fontWeight: FontWeight.w700, color: Colors.white, height: 1.3, letterSpacing: -0.8),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // THE SPECTRAL CORE
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: SizedBox(
                    width: 320,
                    height: 320,
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        return GestureDetector(
                          onTapDown: (details) => _handleTap(details, constraints),
                          child: RepaintBoundary(
                            child: CustomPaint(
                              painter: AiDotMatrixPainter(
                                time: _time,
                                baseColor: activeColor,
                                intensity: isConnecting ? 0.05 : _intensity,
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

                // USER SIGNAL CAPTURE (Scrollable)
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 40),
                    alignment: Alignment.topCenter,
                    child: SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (isListening && provider.partialTranscript.isNotEmpty) ...[
                            Text(
                              provider.partialTranscript,
                              style: TextStyle(fontSize: 16, fontFamily: 'monospace', color: Colors.orangeAccent.withValues(alpha: 0.7), fontStyle: FontStyle.italic),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 12),
                          ],
                          Text(
                            isConnecting ? "ENCRYPTING" : (isProcessing ? "NEURAL PROCESSING" : (isAiSpeaking ? "SIGNAL BROADCAST" : "SIGNAL CAPTURE")),
                            style: TextStyle(fontSize: 10, fontFamily: 'monospace', fontWeight: FontWeight.w900, color: activeColor.withValues(alpha: 0.2), letterSpacing: 6),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 40),
              ],
            ),
          ),
        ],
      ),
    );

  }
}
