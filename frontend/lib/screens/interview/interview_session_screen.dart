import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:go_router/go_router.dart';
import 'dot_matrix_painter.dart';
import '../../core/theme.dart';
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
  
  bool _isEnding = false;
  bool _hasNavigated = false;

  late InterviewProvider _provider;
  late VoidCallback _providerListener;

  @override
  void initState() {
    super.initState();

    // CRITICAL: Reset provider to prevent redirect from old session
    _provider = context.read<InterviewProvider>();
    _provider.resetForNewSession();

    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(days: 1),
    )..addListener(() {
        if (!mounted) return;
        setState(() => _time += 0.016);
      });
    _animationController.repeat();

    _intensityController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    )..addListener(() {
        if (!mounted) return;
        setState(() => _intensity = _intensityController.value);
      });

    _providerListener = () {
      if (mounted) {
        _simulateIntensity(_provider.currentPhase);
      }
    };
    _provider.addListener(_providerListener);

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final type = widget.moduleType ?? (widget.resumeId != null ? 'RESUME' : (widget.websiteUrl != null ? 'WEBSITE' : 'HR'));
      if (!(type == 'RESUME' || type == 'HR' || type == 'WEBSITE' || type == 'INTRO')) {
        throw ArgumentError('Invalid moduleType');
      }

      // Fetch the auth provider to get the selected voice
      final authProvider = context.read<AuthProvider>();
      _provider.setVoice(authProvider.voiceId, engine: 'generative');

      _provider.initSession(
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



  void _showEndInterviewDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A1A),
        title: const Text("End Interview?", style: TextStyle(color: Colors.white)),
        content: const Text("Are you sure you want to end this session?", style: TextStyle(color: Colors.white70)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("CANCEL", style: TextStyle(color: Colors.grey)),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              _handleEnd(context.read<InterviewProvider>());
            },
            child: const Text("END SESSION", style: TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );
  }

  bool _isSimulating = false;

  void _simulateIntensity(InterviewPhase phase) {
    if (_isSimulating || !mounted) return;
    _isSimulating = true;
    
    Future.doWhile(() async {
      final currentPhase = context.read<InterviewProvider>().currentPhase;
      if (!mounted || (currentPhase != InterviewPhase.speaking && currentPhase != InterviewPhase.listening)) {
        _isSimulating = false;
        return false;
      }
      final target = 0.1 + math.Random().nextDouble() * (currentPhase == InterviewPhase.speaking ? 0.4 : 0.8);
      if (mounted) {
        _intensityController.animateTo(target, duration: const Duration(milliseconds: 500), curve: Curves.easeInOut);
      }
      await Future.delayed(const Duration(milliseconds: 600));
      return true;
    });
  }

  @override
  void dispose() {
    _provider.removeListener(_providerListener);
    _animationController.dispose();
    _intensityController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = AppThemeColors.dark;
    final provider = context.watch<InterviewProvider>();
    final isTutor = provider.moduleType == 'WEBSITE';
    final isConnecting = provider.isConnecting;
    final isAiSpeaking = provider.currentPhase == InterviewPhase.speaking;
    final isListening = provider.currentPhase == InterviewPhase.listening;

    // AUTO-END INTERVIEW
    if (provider.isSessionEnded && !_hasNavigated) {
      _hasNavigated = true;
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

    // Determine status text for bottom
    String statusText = "";
    if (isConnecting) {
      statusText = "Establishing connection...";
    } else if (isAiSpeaking && provider.isStreamingText) {
      statusText = "Qlue is thinking...";
    } else if (isAiSpeaking) {
      statusText = "Qlue is speaking...";
    } else if (isListening) {
      statusText = provider.silenceStrikes > 0 ? "Waiting for your response..." : "Listening...";
    }

    // Determine AI text to show at top
    String aiText = "";
    if (!isConnecting) {
      if (provider.isStreamingText && provider.subtitleText.isNotEmpty) {
        aiText = provider.subtitleText;
      } else if (provider.finalQuestionText.isNotEmpty) {
        aiText = provider.finalQuestionText;
      } else if (provider.questionText.isNotEmpty && provider.questionText != "...") {
        aiText = provider.questionText;
      }
    }

    // Determine user text to show at bottom
    String userText = "";
    if (provider.isListening && provider.partialTranscript.isNotEmpty) {
      userText = provider.partialTranscript;
    } else if (provider.finalTranscript.isNotEmpty) {
      userText = provider.finalTranscript;
    }

    // Determine sphere color
    Color sphereColor;
    bool isProcessing = provider.currentPhase == InterviewPhase.processing;
    
    if (isConnecting) {
      sphereColor = Colors.white70; // Off-white glow
    } else if (isAiSpeaking) {
      sphereColor = t.emeraldPrimary; // Green
    } else if (isListening) {
      sphereColor = Colors.orangeAccent; // Orange
    } else if (isProcessing) {
      sphereColor = t.primary; // Processing color (blue/purple)
    } else {
      sphereColor = Colors.white;
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        _showEndInterviewDialog(context);
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            // Spectral Background
            Positioned.fill(
              child: CustomPaint(
                painter: AiDotMatrixPainter(
                  time: _time,
                  intensity: _intensity,
                  baseColor: sphereColor,
                  isInwards: !isAiSpeaking,
                  tapOffset: null,
                  tapTime: 0,
                ),
                size: Size.infinite,
              ),
            ),
 
            // Safe area content
            SafeArea(
              child: Column(
                children: [
                  // TOP BAR
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.5),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: t.emeraldPrimary.withValues(alpha: 0.3),
                              width: 1,
                            ),
                          ),
                          child: Text(
                            "INTERVIEW MODE",
                            style: TextStyle(
                              fontSize: 10,
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w900,
                              color: t.emeraldPrimary.withValues(alpha: 0.6),
                              letterSpacing: 4,
                            ),
                          ),
                        ),
                        GestureDetector(
                          onTap: () => _showEndInterviewDialog(context),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                            decoration: BoxDecoration(
                              color: Colors.red.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: Colors.redAccent.withValues(alpha: 0.3),
                                width: 1,
                              ),
                            ),
                            child: Text(
                              "END",
                              style: TextStyle(
                                color: Colors.redAccent,
                                fontSize: 12,
                                fontWeight: FontWeight.w900,
                                fontFamily: 'monospace',
                                letterSpacing: 2,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
 
                  // AI QUESTION TEXT (TOP) - Plain white text like initial version
                  if (aiText.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 180),
                        child: SingleChildScrollView(
                          child: Text(
                            aiText,
                            style: TextStyle(
                              fontSize: 16,
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w600,
                              color: isTutor ? Colors.tealAccent : Colors.white.withValues(alpha: 0.9),
                              height: 1.4,
                              letterSpacing: -0.5,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                    ),
 
                  // SPACER - pushes content to center/bottom
                  const Spacer(),
 
                  // CENTER SPHERE AREA (empty, sphere is in background)
                  const SizedBox(height: 200),
 
                  const Spacer(),
 
                  // USER TRANSCRIPTION (BOTTOM)
                  if (userText.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 100),
                        child: SingleChildScrollView(
                          child: Text(
                            userText,
                            style: TextStyle(
                              fontSize: 14,
                              fontFamily: 'monospace',
                              fontWeight: FontWeight.w500,
                              color: Colors.orangeAccent.withValues(alpha: 0.8),
                              height: 1.4,
                              letterSpacing: -0.3,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                    ),
 
                  // STATUS TEXT (BOTTOM)
                  if (statusText.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 24, top: 8),
                      child: Text(
                        statusText,
                        style: TextStyle(
                          fontSize: 12,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w700,
                          color: Colors.white.withValues(alpha: 0.4),
                          letterSpacing: 2,
                        ),
                      ),
                    ),
 
                  // SILENCE STRIKES INDICATOR
                  if (provider.silenceStrikes > 0)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(3, (index) {
                          return Container(
                            width: 6,
                            height: 6,
                            margin: const EdgeInsets.symmetric(horizontal: 3),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: index < provider.silenceStrikes
                                  ? Colors.redAccent.withValues(alpha: 0.8)
                                  : Colors.white.withValues(alpha: 0.1),
                            ),
                          );
                        }),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
