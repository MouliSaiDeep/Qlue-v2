import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
import '../../core/theme.dart';
import 'package:provider/provider.dart';
import '../../context/auth_provider.dart';
import '../../context/appearance_provider.dart';
import '../../components/semi_circle_gauge.dart';
import '../../core/models/session_model.dart';
import '../../core/models/feedback_report_model.dart';
import 'package:dio/dio.dart';
import 'package:printing/printing.dart';
import '../../core/network/dio_client.dart';
import '../../core/constants/api_constants.dart';
import '../../components/glass_card.dart';
import '../../components/glass_controls.dart';
import '../../components/spectral_background.dart';
import 'feedback_pdf_export.dart';
import 'widgets/feedback_radar_chart.dart';
import 'widgets/feedback_sections.dart';

class FeedbackReportScreen extends StatefulWidget {
  final SessionModel? session;
  final String? sessionId;

  /// Test hooks: bypass the network fetch so the loading / error / loaded
  /// states can be widget-tested deterministically. Not used in production.
  final FeedbackReportModel? initialReport;
  final String? initialError;
  final bool autoFetch;

  const FeedbackReportScreen({
    super.key,
    this.session,
    this.sessionId,
    @visibleForTesting this.initialReport,
    @visibleForTesting this.initialError,
    @visibleForTesting this.autoFetch = true,
  });

  @override
  State<FeedbackReportScreen> createState() => _FeedbackReportScreenState();
}

class _FeedbackReportScreenState extends State<FeedbackReportScreen> {
  bool _isLoading = true;
  bool _isExporting = false;
  int _activeTabIndex = 0;
  String? _focusedCriterion;
  bool _motionDisabled = false;
  String? _errorMessage;
  FeedbackReportModel? _report;

  Timer? _loadingTimer;
  int _loadingTextIndex = 0;
  final List<String> _loadingPhrases = [
    "Analyzing your transcription...",
    "Evaluating core dimensions...",
    "Reviewing your answer evidence...",
    "Synthesizing actionable feedback...",
    "Finalizing comprehensive report...",
  ];

  @override
  void initState() {
    super.initState();
    if (widget.initialReport != null) {
      _report = widget.initialReport;
      _isLoading = false;
    } else if (widget.initialError != null) {
      _errorMessage = widget.initialError;
      _isLoading = false;
    } else if (widget.autoFetch) {
      _startLoadingAnimation();
      _fetchReport();
    }
  }

  @override
  void dispose() {
    _loadingTimer?.cancel();
    super.dispose();
  }

  void _startLoadingAnimation() {
    _loadingTimer = Timer.periodic(const Duration(seconds: 3), (timer) {
      if (mounted && _isLoading) {
        setState(() {
          _loadingTextIndex = (_loadingTextIndex + 1) % _loadingPhrases.length;
        });
      }
    });
  }

  Future<void> _fetchReport({int retries = 40}) async {
    final sId = widget.session?.sessionId ?? widget.sessionId;
    if (sId == null) {
      setState(() {
        _isLoading = false;
        _errorMessage = "No session information found.";
      });
      return;
    }

    try {
      // FE-BUG FIX: Add cache-buster to prevent browser from caching the GET request during polling
      final cacheBuster = DateTime.now().millisecondsSinceEpoch;
      // Use /dashboard/session/{sessionId} which returns both session and feedback data
      final response = await DioClient().dio.get(
        '${ApiConstants.feedbackReport}/$sId?_t=$cacheBuster',
      );
      if (!mounted) return;

      if (response.statusCode == 200) {
        // FE-BUG FIX: Ensure data is parsed correctly even if API Gateway returns text/plain
        final rawData = response.data;
        final data = rawData is String ? jsonDecode(rawData) : rawData;

        // The endpoint returns {session, feedback, transcript}
        var feedbackData = data['feedback'];
        if (data['session']?['feedbackStatus'] == 'FAILED' ||
            feedbackData?['analysisStatus'] == 'UNAVAILABLE') {
          _loadingTimer?.cancel();
          setState(() {
            _isLoading = false;
            _errorMessage =
                'A reliable assessment could not be produced. No score was assigned. Please retry feedback from History.';
          });
          return;
        }
        if (feedbackData == null &&
            data['session']?['feedbackExpected'] == false) {
          if (!mounted) return;
          setState(() {
            _isLoading = false;
            _errorMessage =
                'No answer was accepted in this interview. Your received text is available in History.';
          });
          return;
        }
        if (feedbackData != null) {
          // FE-BUG FIX: Inject transcript into feedbackData so the model parser can find it
          // Ensure feedbackData is modifiable
          if (feedbackData is Map) {
            feedbackData = Map<String, dynamic>.from(feedbackData);
          }
          if (data['transcript'] != null) {
            feedbackData['transcript'] = data['transcript'];
          }

          setState(() {
            _report = FeedbackReportModel.fromJson(feedbackData);
            _isLoading = false;
          });
        } else {
          if (retries > 0) {
            await Future.delayed(const Duration(seconds: 3));
            if (mounted) _fetchReport(retries: retries - 1);
          } else {
            setState(() {
              _isLoading = false;
              _errorMessage =
                  "Feedback generation is taking longer than expected. Please check back later.";
            });
          }
        }
      } else {
        throw Exception("Failed to load report: ${response.statusCode}");
      }
    } catch (e) {
      if (!mounted) return;
      debugPrint("Error fetching feedback report: $e");
      // Do NOT retry on auth errors (401/403) — they won't resolve on their own.
      final is4xxAuthError =
          e is DioException &&
          (e.response?.statusCode == 401 || e.response?.statusCode == 403);
      final status = e is DioException ? e.response?.statusCode : null;
      final unavailable = status == 422;
      final terminalClientError =
          status != null && status >= 400 && status < 500 && status != 429;
      if (!terminalClientError && retries > 0) {
        // Continue retrying only for transient failures
        await Future.delayed(const Duration(seconds: 3));
        if (mounted) _fetchReport(retries: retries - 1);
      } else {
        _loadingTimer?.cancel();
        setState(() {
          _isLoading = false;
          _errorMessage = is4xxAuthError
              ? "Authentication error. Please log in again and retry."
              : unavailable
              ? 'A reliable assessment could not be produced. No score was assigned. Please retry feedback from History.'
              : status == 404
              ? 'This interview could not be found.'
              : "Unable to load feedback at this time. It may still be generating.";
        });
      }
    }
  }

  Future<void> _exportPdf() async {
    final report = _report;
    if (report == null || _isExporting) return;

    setState(() => _isExporting = true);
    try {
      final auth = context.read<AuthProvider>();
      final topic = widget.session?.topic ?? 'Interview Feedback';
      final role = auth.profession.isNotEmpty
          ? auth.profession
          : (widget.session?.moduleType ?? 'Candidate');
      final score = report.overallScore.round();

      final bytes = await FeedbackPdfBuilder.build(
        report: report,
        topic: topic,
        userName: auth.displayName,
        role: role,
        overallScore: score,
      );

      // Sanitize the topic into a safe filename.
      final safeTopic = topic
          .replaceAll(RegExp(r'[^A-Za-z0-9 _-]'), '')
          .trim()
          .replaceAll(RegExp(r'\s+'), '_');
      await Printing.sharePdf(
        bytes: bytes,
        filename:
            'Qlue_Feedback_${safeTopic.isEmpty ? 'Report' : safeTopic}.pdf',
      );
    } catch (e) {
      debugPrint('PDF export failed: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not export PDF. Please try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isExporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Force Dark Theme Colors for this screen
    final t = AppThemeColors.dark;
    final topPadding = MediaQuery.of(context).padding.top;
    _motionDisabled =
        MediaQuery.disableAnimationsOf(context) ||
        (context.watch<AppearanceProvider?>()?.reduceMotion ?? false);

    return SpectralBackground(
      child: AppThemeColorsProvider(
        colors: t,
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: RepaintBoundary(
            child: _isLoading
                ? _buildLoadingState(context, t)
                : _errorMessage != null
                ? _buildErrorState(context, t)
                : Stack(
                    children: [
                      SingleChildScrollView(
                        padding: EdgeInsets.only(
                          top: topPadding + 20,
                          bottom: 60,
                          left: 24,
                          right: 24,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _buildHeader(context, t),
                            const SizedBox(height: 24),
                            _buildScoreCard(t),
                            const SizedBox(height: 24),
                            _buildSpiderChartCard(t),
                            const SizedBox(height: 32),
                            _buildNavigationTabs(t),
                            const SizedBox(height: 20),
                            _buildContentArea(t),
                            const SizedBox(height: 40),
                            _buildTranscriptSection(t),
                          ],
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }

  Widget _buildLoadingState(BuildContext context, AppThemeColors t) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 64,
              height: 64,
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation<Color>(t.accentGreen),
                strokeWidth: 3,
              ),
            ),
            const SizedBox(height: 32),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 500),
              transitionBuilder: (Widget child, Animation<double> animation) {
                return FadeTransition(
                  opacity: animation,
                  child: SlideTransition(
                    position: Tween<Offset>(
                      begin: const Offset(0.0, 0.2),
                      end: Offset.zero,
                    ).animate(animation),
                    child: child,
                  ),
                );
              },
              child: Text(
                _loadingPhrases[_loadingTextIndex],
                key: ValueKey<int>(_loadingTextIndex),
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: t.text,
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                  letterSpacing: 0.5,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              "This usually takes 15-30 seconds",
              style: TextStyle(color: t.textSecondary, fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorState(BuildContext context, AppThemeColors t) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(FeatherIcons.alertTriangle, size: 48, color: t.warning),
            const SizedBox(height: 16),
            Text(
              _errorMessage!,
              textAlign: TextAlign.center,
              style: TextStyle(color: t.text, fontSize: 16),
            ),
            const SizedBox(height: 24),
            AppButton(
              label: "Go Back",
              expand: false,
              onTap: () => Navigator.pop(context),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, AppThemeColors t) {
    return Row(
      children: [
        AppIconButton(
          icon: FeatherIcons.chevronLeft,
          onTap: () => Navigator.pop(context),
          background: true,
          borderRadius: 12,
          color: t.text,
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "Performance Analysis",
                style: TextStyle(
                  fontSize: 14,
                  color: t.textTertiary,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.0,
                ),
              ),
              Text(
                widget.session?.topic ?? "Interview Feedback",
                style: TextStyle(
                  fontSize: 20,
                  color: t.text,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -0.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        // Export the report as a light-mode PDF that mirrors this screen.
        _isExporting
            ? SizedBox(
                width: 44,
                height: 44,
                child: GlassCard(
                  borderRadius: 12,
                  padding: EdgeInsets.zero,
                  hasMetallicBorder: true,
                  child: Center(
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          t.accentGreen,
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : AppIconButton(
                icon: FeatherIcons.download,
                onTap: _exportPdf,
                background: true,
                borderRadius: 12,
                color: t.text,
                tooltip: 'Export PDF',
              ),
      ],
    );
  }

  /// Bright, meaningful score colors: light green for strong, mustard for
  /// medium, red for low — visible at a glance on the dark theme.
  Color _scoreColor(num score) {
    if (score >= 75) return const Color(0xFF4ADE80); // light green
    if (score >= 50) return const Color(0xFFFBBF24); // mustard
    return const Color(0xFFF87171); // red
  }

  Widget _buildScoreCard(AppThemeColors t) {
    final score = _report!.overallScore.round();
    final auth = context.read<AuthProvider>();
    final color = _scoreColor(score);
    return GlassCard(
      padding: const EdgeInsets.all(20),
      borderRadius: 24,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            auth.displayName,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: t.text,
            ),
          ),
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              final gauge = SemiCircleGauge(
                progress: score / 100,
                color: color,
                trackColor: t.metallicBorder.withValues(alpha: .25),
                width: 168,
                center: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '$score',
                      key: const Key('feedback-overall-score'),
                      textScaler: TextScaler.noScaling,
                      style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w900,
                        color: color,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'OUT OF 100',
                      textScaler: TextScaler.noScaling,
                      style: TextStyle(fontSize: 10, color: t.textSecondary),
                    ),
                  ],
                ),
              );
              final description = Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Overall score',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: t.text,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _report!.assessmentScope == 'FINAL_INTRODUCTION'
                        ? 'Based on your final introduction.'
                        : 'Based on your accepted answers.',
                    style: TextStyle(color: t.textSecondary, height: 1.4),
                  ),
                ],
              );
              return constraints.maxWidth < 300 ||
                      MediaQuery.textScalerOf(context).scale(1) > 1.3
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        gauge,
                        const SizedBox(height: 16),
                        description,
                      ],
                    )
                  : Row(
                      children: [
                        gauge,
                        const SizedBox(width: 24),
                        Expanded(child: description),
                      ],
                    );
            },
          ),
          const SizedBox(height: 16),
          Text(
            'A practice assessment of answer content. It does not measure speaking confidence or predict hiring outcomes.',
            style: TextStyle(color: t.textSecondary, fontSize: 12, height: 1.4),
          ),
        ],
      ),
    );
  }

  Widget _buildSpiderChartCard(AppThemeColors t) {
    final dimensions = _report!.dimensionScores.entries.toList();
    return GlassCard(
      padding: const EdgeInsets.all(20),
      borderRadius: 24,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          buildFeedbackSectionTitle(
            t,
            'Score breakdown',
            FeatherIcons.barChart2,
          ),
          if (dimensions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Tap a point or criterion for details.',
              style: TextStyle(color: t.textSecondary, fontSize: 12),
            ),
          ],
          const SizedBox(height: 16),
          if (dimensions.isEmpty)
            Text(
              'No criterion scores were saved for this report.',
              style: TextStyle(color: t.textSecondary),
            ),
          if (dimensions.length >= 3)
            FeedbackRadarChart(
              scores: _report!.dimensionScores,
              selectedCriterion: _focusedCriterion,
              onSelected: (label) => _showCriterionDetails(t, label),
              accent: t.accentGreen,
              foreground: t.textSecondary,
              pointColor: _scoreColor,
              reduceMotion: _motionDisabled,
            ),
          for (final dimension in dimensions)
            _buildDimensionRow(t, dimension.key, dimension.value),
          if (_report!.practiceBaseline != null ||
              _report!.answerScores.length > 1) ...[
            const SizedBox(height: 24),
            Text(
              _report!.practiceBaseline != null
                  ? 'Your practice progress'
                  : 'Answer by answer',
              style: TextStyle(
                color: t.text,
                fontWeight: FontWeight.bold,
                fontSize: 15,
              ),
            ),
            const SizedBox(height: 14),
            if (_report!.practiceBaseline != null) ...[
              buildFeedbackGlassStatBar(
                t,
                'First introduction',
                _report!.practiceBaseline!.round(),
                _scoreColor(_report!.practiceBaseline!.round()),
              ),
              const SizedBox(height: 12),
              buildFeedbackGlassStatBar(
                t,
                'Revised introduction',
                _report!.overallScore.round(),
                _scoreColor(_report!.overallScore.round()),
              ),
            ] else
              for (final entry in _report!.answerScores.indexed) ...[
                buildFeedbackGlassStatBar(
                  t,
                  'Answer ${entry.$1 + 1}',
                  entry.$2.round(),
                  _scoreColor(entry.$2.round()),
                ),
                const SizedBox(height: 12),
              ],
          ],
        ],
      ),
    );
  }

  Widget _buildDimensionRow(AppThemeColors t, String label, double value) {
    final selected = _focusedCriterion == label;
    final stacked = MediaQuery.textScalerOf(context).scale(1) > 1.3;
    return Semantics(
      selected: selected,
      child: Material(
        color: selected
            ? t.accentGreen.withValues(alpha: .1)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          key: ValueKey('criterion-$label'),
          borderRadius: BorderRadius.circular(12),
          onTap: () => _showCriterionDetails(t, label),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
              child: Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: _scoreColor(value),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          label,
                          style: TextStyle(
                            color: t.text,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (stacked)
                          Text(
                            '${value.round()}/100',
                            style: TextStyle(
                              color: _scoreColor(value),
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (!stacked) const SizedBox(width: 12),
                  if (!stacked)
                    Text(
                      '${value.round()}/100',
                      style: TextStyle(
                        color: _scoreColor(value),
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  const SizedBox(width: 8),
                  Icon(
                    FeatherIcons.chevronRight,
                    size: 15,
                    color: t.textSecondary,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _criterionDetails(AppThemeColors t, String label, double value) {
    ScoreExplanation? explanation;
    for (final item in _report!.scoreExplanations) {
      if (item.label == label) {
        explanation = item;
        break;
      }
    }
    return [
      buildFeedbackGlassStatBar(t, label, value.round(), _scoreColor(value)),
      if (explanation != null && explanation.weight > 0) ...[
        const SizedBox(height: 12),
        Text(
          '${explanation.weight.round()}% of the overall score',
          style: TextStyle(color: t.textSecondary),
        ),
      ],
      const SizedBox(height: 20),
      Text(
        explanation?.reason ??
            'A score explanation was not saved for this older report.',
        style: TextStyle(color: t.text, height: 1.5),
      ),
      if (explanation != null &&
          explanation.evidence.any((q) => q.trim().isNotEmpty)) ...[
        const SizedBox(height: 20),
        Text(
          'From your answer',
          style: TextStyle(color: t.accentGreen, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        for (final quote in explanation.evidence.where(
          (q) => q.trim().isNotEmpty,
        ))
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: SelectableText(
              '“$quote”',
              style: TextStyle(color: t.textSecondary, height: 1.5),
            ),
          ),
      ],
      if (explanation != null && explanation.improvement.isNotEmpty) ...[
        const SizedBox(height: 12),
        Text(
          'Try next',
          style: TextStyle(color: t.accentGreen, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        Text(
          explanation.improvement,
          style: TextStyle(color: t.text, height: 1.5),
        ),
      ],
    ];
  }

  void _showCriterionDetails(AppThemeColors t, String label) {
    final dimensions = _report!.dimensionScores.entries.toList();
    var selected = dimensions.indexWhere((d) => d.key == label);
    if (selected < 0) return;
    setState(() => _focusedCriterion = label);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: t.bgSecondary,
      showDragHandle: true,
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .88,
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, updateSheet) {
          void select(int next) {
            if (next < 0 || next >= dimensions.length) return;
            updateSheet(() => selected = next);
            if (mounted) {
              setState(() => _focusedCriterion = dimensions[next].key);
            }
          }

          final dimension = dimensions[selected];
          return GestureDetector(
            key: const Key('criterion-detail-sheet'),
            onHorizontalDragEnd: (details) {
              final speed = details.primaryVelocity ?? 0;
              if (speed.abs() > 200) select(selected + (speed < 0 ? 1 : -1));
            },
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                24,
                0,
                24,
                24 + MediaQuery.viewPaddingOf(ctx).bottom,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          dimension.key,
                          style: TextStyle(
                            color: t.text,
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Close details',
                        onPressed: () => Navigator.pop(ctx),
                        icon: Icon(FeatherIcons.x, color: t.textSecondary),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      IconButton(
                        tooltip: 'Previous criterion',
                        onPressed: selected > 0
                            ? () => select(selected - 1)
                            : null,
                        icon: const Icon(FeatherIcons.chevronLeft),
                        color: t.accentGreen,
                      ),
                      Expanded(
                        child: Semantics(
                          liveRegion: true,
                          child: Text(
                            '${selected + 1} of ${dimensions.length} · Swipe to compare',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: t.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Next criterion',
                        onPressed: selected < dimensions.length - 1
                            ? () => select(selected + 1)
                            : null,
                        icon: const Icon(FeatherIcons.chevronRight),
                        color: t.accentGreen,
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  ..._criterionDetails(t, dimension.key, dimension.value),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildNavigationTabs(AppThemeColors t) {
    // Keep large text readable on narrow phones.
    if (MediaQuery.textScalerOf(context).scale(1) > 1.3) {
      return Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final entry in ['Summary', 'Strengths', 'To Improve'].indexed)
            ChoiceChip(
              label: Text(entry.$2),
              selected: _activeTabIndex == entry.$1,
              onSelected: (_) => setState(() => _activeTabIndex = entry.$1),
            ),
        ],
      );
    }
    // Inline liquid-glass segmented switcher (same engine as the bottom nav).
    // Switches the content area below between Summary / Strengths / To Improve.
    return lg.GlassTabBar.inline(
      tabs: const [
        lg.GlassTab(label: "Summary"),
        lg.GlassTab(label: "Strengths"),
        lg.GlassTab(label: "To Improve"),
      ],
      selectedIndex: _activeTabIndex,
      onTabSelected: (index) => setState(() => _activeTabIndex = index),
      barHeight: 48,
      indicatorColor: t.primary.withValues(alpha: 0.85),
      selectedLabelColor: Colors.white,
      unselectedLabelColor: t.textSecondary,
      selectedLabelStyle: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.bold,
      ),
      unselectedLabelStyle: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
    );
  }

  Widget _buildContentArea(AppThemeColors t) {
    return GlassCard(
      padding: const EdgeInsets.all(24),
      borderRadius: 24,
      child: AnimatedSwitcher(
        duration: _motionDisabled
            ? Duration.zero
            : const Duration(milliseconds: 300),
        child: _buildTabContent(t),
      ),
    );
  }

  Widget _buildTabContent(AppThemeColors t) {
    switch (_activeTabIndex) {
      case 0: // Summary
        {
          final dims = _report?.dimensionScores ?? const {};
          final dimCount = dims.length;
          final answered =
              _report?.assessedAnswers ??
              (_report?.transcript ?? [])
                  .where((e) => e.role.toUpperCase() == 'USER')
                  .length;
          return Column(
            key: const ValueKey("summary"),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              buildFeedbackSectionTitle(
                t,
                "Executive Summary",
                FeatherIcons.fileText,
              ),
              const SizedBox(height: 16),
              Text(
                _report?.executiveSummary ??
                    "Your performance report is being processed.",
                style: TextStyle(
                  fontSize: 15,
                  height: 1.6,
                  color: t.textSecondary,
                ),
              ),
              if (dimCount > 0) ...[
                const SizedBox(height: 22),
                buildFeedbackGlassStatBar(
                  t,
                  "Overall weighted score",
                  _report!.overallScore.round(),
                  _scoreColor(_report!.overallScore.round()),
                ),
              ],
              const SizedBox(height: 18),
              if (dimCount > 0)
                buildFeedbackMetricRow(
                  t,
                  "Dimensions evaluated",
                  "$dimCount",
                  t.accentGreen,
                ),
              if (answered > 0)
                buildFeedbackMetricRow(
                  t,
                  "Answers assessed",
                  "$answered",
                  t.success,
                ),
            ],
          );
        }
      case 1: // Strengths
        return Column(
          key: const ValueKey("strengths"),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            buildFeedbackSectionTitle(t, "Your Strengths", FeatherIcons.zap),
            const SizedBox(height: 16),
            if (_report?.strengths.isEmpty ?? true)
              buildFeedbackBulletPoint(
                t,
                "No specific strengths were saved in this report.",
                t.success,
              )
            else
              ...(_report?.strengths.map(
                    (s) => buildFeedbackBulletPoint(t, s, t.success),
                  ) ??
                  []),
          ],
        );
      case 2: // Weaknesses + recommended next steps
        {
          final recs = _report?.recommendations ?? const <String>[];
          return Column(
            key: const ValueKey("weaknesses"),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              buildFeedbackSectionTitle(
                t,
                "Areas for Improvement",
                FeatherIcons.alertCircle,
              ),
              const SizedBox(height: 16),
              if (_report?.weaknesses.isEmpty ?? true)
                buildFeedbackBulletPoint(
                  t,
                  "No specific gaps were recorded for this assessment.",
                  t.warning,
                )
              else
                ...(_report?.weaknesses.map(
                      (w) => buildFeedbackBulletPoint(t, w, t.warning),
                    ) ??
                    []),
              if (recs.isNotEmpty) ...[
                const SizedBox(height: 8),
                Divider(color: t.border.withValues(alpha: 0.15), height: 28),
                buildFeedbackSectionTitle(
                  t,
                  "Recommended next steps",
                  FeatherIcons.target,
                ),
                const SizedBox(height: 16),
                ...recs.asMap().entries.map(
                  (e) => buildFeedbackRecommendationItem(t, e.key + 1, e.value),
                ),
              ],
            ],
          );
        }
      default:
        return const SizedBox();
    }
  }

  Widget _buildTranscriptSection(AppThemeColors t) {
    // Use transcript from report if available, otherwise show message
    final transcript = _report?.transcript ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        buildFeedbackSectionTitle(
          t,
          "Q&A Transcript",
          FeatherIcons.messageSquare,
        ),
        const SizedBox(height: 20),
        transcript.isEmpty
            ? GlassCard(
                padding: const EdgeInsets.all(24),
                borderRadius: 24,
                child: Center(
                  child: Text(
                    "Transcript not available",
                    style: TextStyle(color: t.textSecondary),
                  ),
                ),
              )
            : GlassCard(
                padding: const EdgeInsets.all(24),
                borderRadius: 24,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: transcript.map((item) {
                    final isAI = item.role.toUpperCase() == 'AI';
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (transcript.indexOf(item) > 0)
                          const Divider(
                            height: 24,
                            thickness: 1,
                            color: Colors.white12,
                          ),
                        _buildTranscriptItem(
                          t,
                          isAI ? "AI: ${item.text}" : "You: ${item.text}",
                          isAI,
                        ),
                      ],
                    );
                  }).toList(),
                ),
              ),
      ],
    );
  }

  Widget _buildTranscriptItem(AppThemeColors t, String text, bool isQuestion) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          isQuestion ? FeatherIcons.mic : FeatherIcons.user,
          size: 16,
          color: isQuestion ? t.accentGreen : t.textSecondary,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: TextStyle(color: t.text, height: 1.5, fontSize: 14),
          ),
        ),
      ],
    );
  }
}
