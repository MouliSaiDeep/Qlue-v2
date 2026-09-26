import 'dart:async';
import 'package:flutter/material.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/context/appearance_provider.dart';
import 'package:go_router/go_router.dart';
import 'particle_sphere.dart';
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

class _InterviewSessionScreenState extends State<InterviewSessionScreen> {
  // Maps the active module to its accent color (used while the AI speaks).
  Color _moduleAccentColor(AppThemeColors t, String? moduleType) {
    switch (moduleType) {
      case 'HR':
        return t.moduleHR;
      case 'WEBSITE':
        return t.moduleWeb;
      case 'INTRO':
        return t.moduleIntro;
      case 'JD':
        return t.moduleJobMatch;
      case 'RESUME':
      default:
        return t.moduleResume;
    }
  }

  bool _isEnding = false;
  bool _hasNavigated = false;

  late InterviewProvider _provider;
  late VoidCallback _providerListener;

  Timer? _statusTimer;
  int _messageIndex = 0;

  List<String> get _loadingMessages {
    switch (widget.moduleType) {
      case 'RESUME':
        return ["Analyzing your resume...", "Scanning key skills and experience...", "Preparing personalized questions..."];
      case 'WEBSITE':
        return ["Analyzing the study material...", "Extracting key concepts...", "Preparing tutor session..."];
      case 'INTRO':
        return ["Analyzing communication style...", "Preparing introduction assessment...", "Calibrating evaluation criteria..."];
      case 'HR':
      default:
        return ["Analyzing behavioral patterns...", "Calibrating question difficulty...", "Preparing situational scenarios..."];
    }
  }

  void _startStatusTimer() {
    _statusTimer?.cancel();
    _statusTimer = Timer.periodic(const Duration(seconds: 3), (timer) {
      if (mounted) {
        setState(() {
          _messageIndex = (_messageIndex + 1) % _loadingMessages.length;
        });
      }
    });
  }

  @override
  void initState() {
    super.initState();

    _provider = context.read<InterviewProvider>();

    _providerListener = () {
      if (mounted) {
        if (_provider.isConnecting && _statusTimer == null) {
          _startStatusTimer();
        } else if (!_provider.isConnecting && _statusTimer != null) {
          _statusTimer?.cancel();
          _statusTimer = null;
        }
      }
    };
    _provider.addListener(_providerListener);

    // Reset provider immediately to prevent redirect from old session state in the first build
    _provider.resetForNewSession();

    // Init deferred to post-frame to ensure any async side-effects or further notifications 
    // happen safely after the initial build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;

      final type = widget.moduleType ?? (widget.resumeId != null ? 'RESUME' : (widget.websiteUrl != null ? 'WEBSITE' : 'HR'));
      if (!(type == 'RESUME' || type == 'HR' || type == 'WEBSITE' || type == 'INTRO' || type == 'JD')) {
        throw ArgumentError('Invalid moduleType');
      }

      // Fetch the auth provider to get the selected voice + mode. Premium mode
      // uses generative voices; cost-saver stays on the cheaper neural engine.
      final authProvider = context.read<AuthProvider>();
      _provider.setVoice(authProvider.voiceId, voiceMode: authProvider.voiceMode);

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
    // FE-BUG #18 FIX: catch errors from endSession so they don't swallow silently
    await provider.endSession().catchError((e) {
      debugPrint('[InterviewSession] endSession error: $e');
    });
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

  @override
  void dispose() {
    _statusTimer?.cancel();
    _provider.removeListener(_providerListener);
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
    Widget statusWidget = const SizedBox.shrink();
    if (isConnecting) {
      statusWidget = AnimatedSwitcher(
        duration: const Duration(milliseconds: 500),
        transitionBuilder: (Widget child, Animation<double> animation) {
          return FadeTransition(opacity: animation, child: child);
        },
        child: Text(
          _loadingMessages[_messageIndex],
          key: ValueKey<int>(_messageIndex),
          style: TextStyle(
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: FontWeight.w700,
            color: Colors.white.withValues(alpha: 0.4),
            letterSpacing: 2,
          ),
        ),
      );
    } else {
      String statusText = "";
      if (isAiSpeaking && provider.isStreamingText) {
        statusText = "Qlue is thinking...";
      } else if (isAiSpeaking) {
        statusText = "Qlue is speaking...";
      } else if (isListening) {
        statusText = provider.silenceStrikes > 0 ? "Waiting for your response..." : "Listening...";
      }
      if (statusText.isNotEmpty) {
        statusWidget = Text(
          statusText,
          style: TextStyle(
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: FontWeight.w700,
            color: Colors.white.withValues(alpha: 0.4),
            letterSpacing: 2,
          ),
        );
      }
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

    // The selected module's accent color drives the bubble while the AI speaks;
    // listening/idle fall back to a soft off-white (handled in ParticleSphere).
    final moduleAccent =
        _moduleAccentColor(t, provider.moduleType ?? widget.moduleType);

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
 
                  // CENTER SPHERE — particle bubble reacts to speak/listen state
                  SizedBox(
                    height: 320,
                    child: ParticleSphere(
                      moduleColor: moduleAccent,
                      isSpeaking: isAiSpeaking,
                      isListening: isListening,
                      animate: !context.read<AppearanceProvider>().reduceMotion,
                    ),
                  ),
 
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
                  Padding(
                    padding: const EdgeInsets.only(bottom: 24, top: 8),
                    child: statusWidget,
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
