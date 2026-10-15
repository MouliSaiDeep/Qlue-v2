import 'dart:async';
import 'package:flutter/material.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:frontend/context/appearance_provider.dart';
import 'package:go_router/go_router.dart';
import 'particle_sphere.dart';
import 'interview_recovery_controls.dart';
import 'interview_screen_awake.dart';
import 'interview_transcript.dart';
import '../../shared/services/screen_awake_service.dart';
import '../../core/theme.dart';
import '../../features/interview/providers/interview_provider.dart';
import 'package:provider/provider.dart';

class InterviewSessionScreen extends StatefulWidget {
  final String? interviewId;
  final String? resumeId;
  final String? websiteUrl;
  final String? moduleType;
  final String? analysisId;
  final ScreenAwakeService? screenAwakeService;

  const InterviewSessionScreen({
    super.key,
    this.interviewId,
    this.resumeId,
    this.websiteUrl,
    this.moduleType,
    this.analysisId,
    this.screenAwakeService,
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

  List<String> get _loadingMessages => const ['Preparing your interview…'];

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

      final type =
          widget.moduleType ??
          (widget.resumeId != null
              ? 'RESUME'
              : (widget.websiteUrl != null ? 'WEBSITE' : 'HR'));
      if (!(type == 'RESUME' ||
          type == 'HR' ||
          type == 'WEBSITE' ||
          type == 'INTRO' ||
          type == 'JD')) {
        throw ArgumentError('Invalid moduleType');
      }

      // Fetch the auth provider to get the selected voice + mode. Premium mode
      // uses generative voices; cost-saver stays on the cheaper neural engine.
      final authProvider = context.read<AuthProvider>();
      _provider.setVoice(
        authProvider.voiceId,
        voiceMode: authProvider.voiceMode,
      );

      _provider.initSession(
        type,
        resumeId: widget.resumeId,
        websiteUrl: widget.websiteUrl,
        analysisId: widget.analysisId,
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
        title: const Text(
          "End Interview?",
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          "Are you sure you want to end this session?",
          style: TextStyle(color: Colors.white70),
        ),
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
            child: const Text(
              "END SESSION",
              style: TextStyle(color: Colors.redAccent),
            ),
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
    // Recognition hypotheses update only the transcript viewport. Keeping them
    // out of this subscription avoids rebuilding the animation and controls.
    context.select<InterviewProvider, Object>(
      (p) => (
        p.moduleType,
        p.isConnecting,
        p.currentPhase,
        p.isSessionEnded,
        p.feedbackExpected,
        p.isStreamingText,
        p.subtitleText,
        p.finalQuestionText,
        p.questionText,
        p.isListening,
        p.silenceStrikes,
        p.replayQuestionAvailable,
        p.canReplayQuestion,
        p.isFinalizingTranscript,
        p.errorMessage,
        p.recordingNotice,
      ),
    );
    final provider = context.read<InterviewProvider>();
    final isTutor = provider.moduleType == 'WEBSITE';
    final isConnecting = provider.isConnecting;
    final isAiSpeaking = provider.currentPhase == InterviewPhase.speaking;
    final isListening = provider.currentPhase == InterviewPhase.listening;

    // AUTO-END INTERVIEW
    if (provider.isSessionEnded && !_hasNavigated) {
      _hasNavigated = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          if ((provider.terminationReason == 'RECOGNITION_RECOVERY_LIMIT' ||
                  provider.feedbackExpected == false) &&
              provider.errorMessage != null) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(SnackBar(content: Text(provider.errorMessage!)));
          }
          if (provider.feedbackExpected == false) {
            context.go('/history');
          } else if (isTutor) {
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
        statusText = !provider.isListening
            ? 'Getting microphone ready…'
            : provider.silenceStrikes > 0
            ? "Waiting for your response..."
            : "Listening...";
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
      } else if (provider.questionText.isNotEmpty &&
          provider.questionText != "...") {
        aiText = provider.questionText;
      }
    }

    // The selected module's accent color drives the bubble while the AI speaks;
    // listening/idle fall back to a soft off-white (handled in ParticleSphere).
    final moduleAccent = _moduleAccentColor(
      t,
      provider.moduleType ?? widget.moduleType,
    );

    return InterviewScreenAwake(
      provider: provider,
      service: widget.screenAwakeService,
      child: PopScope(
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
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    // Keep v1.0.8's centered composition on ordinary phones.
                    // Short screens and large text scroll so the current
                    // recovery controls and transcript remain accessible.
                    final compact =
                        constraints.maxHeight < 780 ||
                        MediaQuery.textScalerOf(context).scale(1) > 1.3 ||
                        provider.errorMessage != null ||
                        provider.recordingNotice != null ||
                        isConnecting;
                    final sphere = SizedBox(
                      key: const Key('interview-sphere-slot'),
                      height: compact
                          ? (constraints.maxHeight *
                                    0.25 /
                                    MediaQuery.textScalerOf(context).scale(1))
                                .clamp(72.0, 240.0)
                          : 320,
                      child: RepaintBoundary(
                        child: ParticleSphere(
                          moduleColor: moduleAccent,
                          isSpeaking: isAiSpeaking,
                          isListening: isListening,
                          animate: !context
                              .read<AppearanceProvider>()
                              .reduceMotion,
                        ),
                      ),
                    );
                    final content = Column(
                      children: [
                        // TOP BAR
                        Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 16,
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Flexible(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 6,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.black.withValues(alpha: 0.5),
                                    borderRadius: BorderRadius.circular(20),
                                    border: Border.all(
                                      color: t.emeraldPrimary.withValues(
                                        alpha: 0.3,
                                      ),
                                      width: 1,
                                    ),
                                  ),
                                  child: Text(
                                    "INTERVIEW MODE",
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontFamily: 'monospace',
                                      fontWeight: FontWeight.w900,
                                      color: t.emeraldPrimary.withValues(
                                        alpha: 0.6,
                                      ),
                                      letterSpacing: 4,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              GestureDetector(
                                onTap: () => _showEndInterviewDialog(context),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 8,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.red.withValues(alpha: 0.1),
                                    borderRadius: BorderRadius.circular(20),
                                    border: Border.all(
                                      color: Colors.redAccent.withValues(
                                        alpha: 0.3,
                                      ),
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
                            padding: const EdgeInsets.symmetric(
                              horizontal: 24,
                              vertical: 12,
                            ),
                            child: ConstrainedBox(
                              constraints: BoxConstraints(
                                maxHeight:
                                    (MediaQuery.sizeOf(context).height * 0.23)
                                        .clamp(96.0, 220.0),
                              ),
                              child: SingleChildScrollView(
                                child: Text(
                                  aiText,
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontFamily: 'monospace',
                                    fontWeight: FontWeight.w600,
                                    color: isTutor
                                        ? Colors.tealAccent
                                        : Colors.white.withValues(alpha: 0.9),
                                    height: 1.4,
                                    letterSpacing: -0.5,
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            ),
                          ),

                        if (compact && !isConnecting) const SizedBox(height: 8),
                        if (isConnecting)
                          const Spacer()
                        else if (compact)
                          sphere
                        else
                          Expanded(child: Center(child: sphere)),
                        if (compact && !isConnecting) const SizedBox(height: 8),

                        // USER TRANSCRIPTION (BOTTOM)
                        const InterviewTranscript(),

                        // STATUS TEXT (BOTTOM)
                        InterviewRecoveryControls(provider: provider),
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
                                  margin: const EdgeInsets.symmetric(
                                    horizontal: 3,
                                  ),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: index < provider.silenceStrikes
                                        ? Colors.redAccent.withValues(
                                            alpha: 0.8,
                                          )
                                        : Colors.white.withValues(alpha: 0.1),
                                  ),
                                );
                              }),
                            ),
                          ),
                      ],
                    );
                    if (isConnecting) {
                      // Center the starting bubble in the safe viewport,
                      // independently of the header and reserved transcript.
                      return Stack(
                        children: [
                          Center(child: sphere),
                          content,
                        ],
                      );
                    }
                    return compact
                        ? SingleChildScrollView(child: content)
                        : content;
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
