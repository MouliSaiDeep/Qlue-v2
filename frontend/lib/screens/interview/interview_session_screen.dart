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
  final String? moduleType;

  const InterviewSessionScreen({
    super.key, 
    this.interviewId,
    this.resumeId,
    this.websiteUrl,
    this.moduleType,
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
  bool _isEnding = false;

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
      final interviewProvider = context.read<InterviewProvider>();
      
      // Attach listener for intensity simulation
      interviewProvider.addListener(() {
        if (mounted) {
          _simulateIntensity(interviewProvider.currentPhase);
        }
      });

      final type = widget.moduleType ?? (widget.resumeId != null ? 'RESUME' : (widget.websiteUrl != null ? 'WEBSITE' : 'HR'));
      assert(type == 'RESUME' || type == 'HR' || type == 'WEBSITE' || type == 'INTRO', 'Invalid moduleType');

      interviewProvider.initSession(
        type, 
        resumeId: widget.resumeId,
        websiteUrl: widget.websiteUrl,
      );
    });
  }

  void _handleEnd(InterviewProvider provider) async {
    if (_isEnding) return;
    setState(() => _isEnding = true);
    await provider.endSession();
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
    
    final isTutor = provider.moduleType == 'WEBSITE';

    // Auto-End Navigation
    if (provider.isSessionEnded) {
       WidgetsBinding.instance.addPostFrameCallback((_) {
         if (mounted) {
           if (isTutor) {
             context.go('/dashboard');
           } else {
             context.pushReplacement('/feedback/${provider.sessionId}');
           }
         }
       });
    }

    final interviewPhase = provider.currentPhase;
    bool isAiSpeaking = interviewPhase == InterviewPhase.speaking;
    bool isListening = interviewPhase == InterviewPhase.listening;
    bool isProcessing = interviewPhase == InterviewPhase.processing;
    bool isConnecting = provider.isConnecting;

    // STATE-SPECIFIC CHROMATICS
    Color activeColor = t.emeraldPrimary; 
    if (isListening) activeColor = Colors.orangeAccent;
    if (isProcessing) activeColor = Colors.blueAccent;
    if (isConnecting) activeColor = Colors.white.withValues(alpha: 0.3);

    // Determine what text to show on top:
    // - While AI is speaking: show streaming subtitle text
    // - After AI finishes: show only the question text
    // - While connecting: show "Connecting..."
    String topDisplayText;
    if (isConnecting) {
      topDisplayText = "Connecting...";
    } else if (isAiSpeaking && provider.isStreamingText && provider.subtitleText.isNotEmpty) {
      // While AI is speaking: show streaming subtitle with typing effect
      topDisplayText = provider.subtitleText;
    } else if (provider.finalQuestionText.isNotEmpty) {
      // After AI finishes: show the finalized question
      topDisplayText = provider.finalQuestionText;
    } else if (provider.questionText.isNotEmpty && provider.questionText != "...") {
      topDisplayText = provider.questionText;
    } else {
      topDisplayText = "Waiting...";
    }

    // Determine bottom display text for user transcription
    String bottomDisplayText = "";
    bool showUserTranscription = false;
    
    if (isListening && provider.partialTranscript.isNotEmpty) {
      bottomDisplayText = provider.partialTranscript;
      showUserTranscription = true;
    } else if ((isProcessing || isAiSpeaking) && provider.finalTranscript.isNotEmpty) {
      // Keep showing last user transcript while AI is responding
      bottomDisplayText = provider.finalTranscript;
      showUserTranscription = true;
    }

    return PopScope(
      canPop: false, // Prevent system back navigation
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        // Optionally show a dialog here, or just ignore
      },
      child: Scaffold(
        backgroundColor: Colors.black, 
        body: Stack(
          children: [
            // 1. THE LAYOUT ENGINE
            SafeArea(
              child: Column(
                children: [
                  // TOP: SESSION CONTROL
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (isTutor)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.teal.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: Colors.teal.withValues(alpha: 0.3)),
                            ),
                            child: const Text(
                              "TUTOR MODE",
                              style: TextStyle(color: Colors.teal, fontSize: 10, fontWeight: FontWeight.bold),
                            ),
                          )
                        else
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: t.emeraldPrimary.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: t.emeraldPrimary.withValues(alpha: 0.3)),
                            ),
                            child: Text(
                              "INTERVIEW MODE",
                              style: TextStyle(color: t.emeraldPrimary, fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                          ),
                        const Spacer(),
                        GestureDetector(
                          onTap: _isEnding ? null : () => _handleEnd(provider),
                          child: SizedBox(
                            width: 80,
                            height: 44,
                            child: GlassCard(
                              borderRadius: 12,
                              padding: EdgeInsets.zero,
                              hasMetallicBorder: true,
                              child: Center(
                                child: Text(
                                  "END",
                                  style: TextStyle(
                                    color: Colors.redAccent.withValues(alpha: 0.8),
                                    fontSize: 12,
                                    fontFamily: 'monospace',
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 2
                                  ),
                                )
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                // AI SUBTITLE / QUESTION BROADCAST (Scrollable)
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 40),
                    alignment: Alignment.bottomCenter,
                    child: SingleChildScrollView(
                      reverse: true,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        decoration: BoxDecoration(
                          color: t.emeraldLight.withValues(alpha: 0.6), // subtle emerald green bg
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: t.emeraldPrimary.withValues(alpha: 0.3),
                            width: 1,
                          ),
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // Label
                            Text(
                              isConnecting
                                  ? "ESTABLISHING NEURAL LINK"
                                  : (isAiSpeaking && provider.isStreamingText
                                      ? "AI SPEAKING"
                                      : "SYSTEM BROADCAST"),
                              style: TextStyle(
                                fontSize: 10,
                                fontFamily: 'monospace',
                                fontWeight: FontWeight.w900,
                                color: isAiSpeaking && provider.isStreamingText
                                    ? t.emeraldPrimary.withValues(alpha: 0.6)
                                    : Colors.white.withValues(alpha: 0.2),
                                letterSpacing: 4,
                              ),
                            ),
                            const SizedBox(height: 12),
                            // Main text
                            AnimatedOpacity(
                              duration: const Duration(milliseconds: 300),
                              opacity: 1.0,
                              child: Text(
                                topDisplayText,
                                style: TextStyle(
                                  fontSize: isAiSpeaking && provider.isStreamingText ? 16 : 18,
                                  fontFamily: 'monospace',
                                  fontWeight: FontWeight.w700,
                                  color: isTutor 
                                      ? Colors.tealAccent 
                                      : (isAiSpeaking && provider.isStreamingText
                                          ? t.emeraldPrimary.withValues(alpha: 0.95)
                                          : Colors.white),
                                  height: 1.3,
                                  letterSpacing: -0.8,
                                ),
                                textAlign: TextAlign.center,
                                maxLines: 10,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (isAiSpeaking && provider.isStreamingText) ...[
                              const SizedBox(height: 8),
                              _buildSpeakingIndicator(t),
                            ],
                          ],
                        ),
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
                    child: _isEnding 
                      ? Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const CircularProgressIndicator(color: Colors.white),
                            const SizedBox(height: 20),
                            Text(
                              isTutor ? "Closing Session..." : "Generating your interview feedback...",
                              style: const TextStyle(color: Colors.white, fontSize: 12, fontFamily: 'monospace'),
                            ),
                          ],
                        )
                      : LayoutBuilder(
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

                // USER TRANSCRIPTION CAPTURE (Scrollable)
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 40),
                    alignment: Alignment.topCenter,
                    child: SingleChildScrollView(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // User transcription text
                          if (showUserTranscription) ...[
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                              decoration: BoxDecoration(
                                color: Colors.orangeAccent.withValues(alpha: 0.12), // Slightly more visible
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: Colors.orangeAccent.withValues(alpha: 0.3),
                                  width: 1,
                                ),
                              ),
                              child: Column(
                                children: [
                                  Text(
                                    "YOU",
                                    style: TextStyle(
                                      fontSize: 10, // Slightly larger
                                      fontFamily: 'monospace',
                                      fontWeight: FontWeight.w900,
                                      color: Colors.orangeAccent.withValues(alpha: 0.6),
                                      letterSpacing: 4,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    bottomDisplayText,
                                    style: TextStyle(
                                      fontSize: 15, // Slightly larger
                                      fontFamily: 'monospace',
                                      color: Colors.orangeAccent.withValues(alpha: isListening ? 0.9 : 0.6),
                                      fontStyle: isListening ? FontStyle.italic : FontStyle.normal,
                                      height: 1.3,
                                    ),
                                    textAlign: TextAlign.center,
                                    maxLines: 10,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
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
    ));
  }

  /// Animated speaking indicator (three pulsing dots) shown while AI is speaking
  Widget _buildSpeakingIndicator(AppThemeColors t) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(3, (index) {
        return AnimatedBuilder(
          animation: _animationController,
          builder: (context, child) {
            final phase = (_time * 2 + index * 0.5) % 1.5;
            final scale = phase < 0.75 ? 0.5 + phase : 1.25 - (phase - 0.75);
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: 6 * scale,
              height: 6 * scale,
              decoration: BoxDecoration(
                color: t.emeraldPrimary.withValues(alpha: 0.6),
                shape: BoxShape.circle,
              ),
            );
          },
        );
      }),
    );
  }
}
