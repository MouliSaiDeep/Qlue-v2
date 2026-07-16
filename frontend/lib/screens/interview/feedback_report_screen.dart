import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:feather_icons/feather_icons.dart';
import '../../core/theme.dart';
import 'package:provider/provider.dart';
import '../../context/auth_provider.dart';
import '../../components/semi_circle_gauge.dart';
import '../../core/models/session_model.dart';
import '../../core/models/feedback_report_model.dart';
import 'package:dio/dio.dart';
import '../../core/network/dio_client.dart';
import '../../core/constants/api_constants.dart';
import '../../components/glass_card.dart';
import '../../components/spectral_background.dart';

class FeedbackReportScreen extends StatefulWidget {
  final SessionModel? session;
  final String? sessionId;

  const FeedbackReportScreen({super.key, this.session, this.sessionId});

  @override
  State<FeedbackReportScreen> createState() => _FeedbackReportScreenState();
}

class _FeedbackReportScreenState extends State<FeedbackReportScreen> {
  int _activeTabIndex = 0;
  bool _isLoading = true;
  String? _errorMessage;
  FeedbackReportModel? _report;

  Timer? _loadingTimer;
  int _loadingTextIndex = 0;
  final List<String> _loadingPhrases = [
    "Analyzing your transcription...",
    "Evaluating core dimensions...",
    "Cross-referencing behavioral patterns...",
    "Synthesizing actionable feedback...",
    "Finalizing comprehensive report...",
  ];

  @override
  void initState() {
    super.initState();
    _startLoadingAnimation();
    _fetchReport();
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

      if (response.statusCode == 200) {
        // FE-BUG FIX: Ensure data is parsed correctly even if API Gateway returns text/plain
        final rawData = response.data;
        final data = rawData is String ? jsonDecode(rawData) : rawData;
        
        // The endpoint returns {session, feedback, transcript}
        var feedbackData = data['feedback'];
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
      debugPrint("Error fetching feedback report: $e");
      // Do NOT retry on auth errors (401/403) — they won't resolve on their own.
      final is4xxAuthError = e is DioException &&
          (e.response?.statusCode == 401 || e.response?.statusCode == 403);
      if (!is4xxAuthError && retries > 0) {
        // Continue retrying only for transient failures
        await Future.delayed(const Duration(seconds: 3));
        if (mounted) _fetchReport(retries: retries - 1);
      } else {
        setState(() {
          _isLoading = false;
          _errorMessage = is4xxAuthError
              ? "Authentication error. Please log in again and retry."
              : "Unable to load feedback at this time. It may still be generating.";
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Force Dark Theme Colors for this screen
    final t = AppThemeColors.dark;
    final topPadding = MediaQuery.of(context).padding.top;

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
                valueColor: AlwaysStoppedAnimation<Color>(t.primary),
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
              style: TextStyle(
                color: t.textSecondary,
                fontSize: 14,
              ),
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
            ElevatedButton(
              onPressed: () => Navigator.pop(context),
              child: const Text("Go Back"),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, AppThemeColors t) {
    return Row(
      children: [
        GestureDetector(
          onTap: () => Navigator.pop(context),
          child: SizedBox(
            width: 44,
            height: 44,
            child: GlassCard(
              borderRadius: 12,
              padding: EdgeInsets.zero,
              hasMetallicBorder: true,
              child: Center(
                child: Icon(FeatherIcons.chevronLeft, size: 20, color: t.text),
              ),
            ),
          ),
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
      ],
    );
  }

  Widget _buildScoreCard(AppThemeColors t) {
    final score = _report?.overallScore.round() ?? widget.session?.score ?? 0;
    final auth = context.read<AuthProvider>();
    final String role = auth.profession.isNotEmpty
        ? auth.profession
        : (_report?.moduleType ?? widget.session?.moduleType ?? 'Candidate');
    final Color scoreColor =
        score >= 75 ? t.success : (score >= 50 ? t.primary : Colors.orangeAccent);

    return GlassCard(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
      borderRadius: 24,
      blurSigma: 26,
      child: Row(
        children: [
          // Identity
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  auth.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    color: t.text,
                    letterSpacing: -0.4,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  role,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12.5, color: t.textSecondary),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: scoreColor.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: scoreColor.withValues(alpha: 0.25)),
                  ),
                  child: Text(
                    score >= 80
                        ? "Top 15% of candidates"
                        : score >= 50
                            ? "Solid performance"
                            : "Keep practicing!",
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: scoreColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Score gauge
          SemiCircleGauge(
            progress: score / 100.0,
            color: scoreColor,
            trackColor: t.metallicBorder.withValues(alpha: 0.25),
            width: 128,
            strokeWidth: 11,
            center: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  "$score",
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                    color: t.text,
                    height: 1.0,
                  ),
                ),
                Text("OVERALL",
                    style: TextStyle(
                        fontSize: 8.5,
                        letterSpacing: 1.5,
                        color: t.textTertiary)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSpiderChartCard(AppThemeColors t) {
    List<double> finalData = [0.8, 0.7, 0.9];
    List<String> finalLabels = ["Clarity", "Fluency", "Vocabulary"];
    List<MapEntry<String, num>> allDims = [];

    if (_report != null && _report!.dimensionScores.isNotEmpty) {
      allDims = _report!.dimensionScores.entries
          .map((e) => MapEntry(e.key, e.value as num))
          .toList()
        ..sort((a, b) => b.value.compareTo(a.value));
      final chartDims = allDims.take(3).toList();
      finalData = chartDims.map((e) => e.value / 100.0).toList();
      finalLabels = chartDims.map((e) => e.key).toList();
      while (finalData.length < 3) {
        finalData.add(0.8);
        finalLabels.add("Metric ${finalData.length}");
      }
    }

    return GlassCard(
      padding: const EdgeInsets.all(20),
      borderRadius: 24,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "Dimension Breakdown",
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: t.text),
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(
                width: 140,
                height: 140,
                child: CustomPaint(
                  painter: RadarChartPainter(
                    t: t,
                    data: finalData,
                    labels: finalLabels,
                  ),
                ),
              ),
              const SizedBox(width: 18),
              // Every dimension with its exact value — the info the big
              // chart alone never conveyed.
              Expanded(
                child: Column(
                  children: (allDims.isEmpty
                          ? finalLabels.asMap().entries.map((e) =>
                              MapEntry(e.value, (finalData[e.key] * 100)))
                          : allDims.map((e) => MapEntry(e.key, e.value.toDouble())))
                      .map((d) => _buildDimensionBar(t, d.key, d.value.toDouble()))
                      .toList(),
                ),
              ),
            ],
          ),
          if (allDims.length >= 2) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Icon(FeatherIcons.award, size: 13, color: t.success),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    "Strongest: ${allDims.first.key} · Focus next: ${allDims.last.key}",
                    style: TextStyle(fontSize: 11.5, color: t.textSecondary),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDimensionBar(AppThemeColors t, String label, double value) {
    final Color barColor =
        value >= 75 ? t.success : (value >= 50 ? t.primary : Colors.orangeAccent);
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11.5, color: t.textSecondary)),
              ),
              Text("${value.round()}",
                  style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.bold,
                      color: t.text)),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: (value / 100).clamp(0.0, 1.0),
              minHeight: 5,
              backgroundColor: t.metallicBorder.withValues(alpha: 0.15),
              valueColor: AlwaysStoppedAnimation<Color>(barColor),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNavigationTabs(AppThemeColors t) {
    return SizedBox(
      height: 54,
      child: GlassCard(
        borderRadius: 30,
        padding: const EdgeInsets.all(4),
        hasMetallicBorder: true,
        child: Stack(
          children: [
            // Sliding Indicator
            AnimatedAlign(
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeOutQuart,
              alignment: _activeTabIndex == 0
                  ? Alignment.centerLeft
                  : (_activeTabIndex == 1
                        ? Alignment.center
                        : Alignment.centerRight),
              child: FractionallySizedBox(
                widthFactor: 0.33,
                child: Container(
                  decoration: BoxDecoration(
                    color: t.primary,
                    borderRadius: BorderRadius.circular(24),
                    boxShadow: [
                      BoxShadow(
                        color: t.primary.withValues(alpha: 0.4),
                        blurRadius: 12,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            // Tab Items
            Row(
              children: [
                Expanded(child: _buildCustomTab(0, "Summary", t)),
                Expanded(child: _buildCustomTab(1, "Strengths", t)),
                Expanded(child: _buildCustomTab(2, "Weaknesses", t)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCustomTab(int index, String label, AppThemeColors t) {
    final isSelected = _activeTabIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _activeTabIndex = index),
      behavior: HitTestBehavior.opaque,
      child: Center(
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.w600,
            color: isSelected ? Colors.white : t.textSecondary,
          ),
        ),
      ),
    );
  }

  Widget _buildContentArea(AppThemeColors t) {
    return GlassCard(
      padding: const EdgeInsets.all(24),
      borderRadius: 24,
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 300),
        child: _buildTabContent(t),
      ),
    );
  }

  Widget _buildTabContent(AppThemeColors t) {
    switch (_activeTabIndex) {
      case 0: // Summary
        return Column(
          key: const ValueKey("summary"),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionTitle(t, "Executive Summary", FeatherIcons.fileText),
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
            const SizedBox(height: 20),
            _buildMetricRow(t, "Confidence Level", "High", t.primary),
            _buildMetricRow(t, "Pace", "Steady", t.success),
          ],
        );
      case 1: // Strengths
        return Column(
          key: const ValueKey("strengths"),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionTitle(t, "Your Strengths", FeatherIcons.zap),
            const SizedBox(height: 16),
            if (_report?.strengths.isEmpty ?? true)
              _buildBulletPoint(
                t,
                "Great effort in completing the session.",
                t.success,
              )
            else
              ...(_report?.strengths.map(
                    (s) => _buildBulletPoint(t, s, t.success),
                  ) ??
                  []),
          ],
        );
      case 2: // Weaknesses
        return Column(
          key: const ValueKey("weaknesses"),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionTitle(
              t,
              "Areas for Improvement",
              FeatherIcons.alertCircle,
            ),
            const SizedBox(height: 16),
            if (_report?.weaknesses.isEmpty ?? true)
              _buildBulletPoint(t, "No major weaknesses identified.", t.warning)
            else
              ...(_report?.weaknesses.map(
                    (w) => _buildBulletPoint(t, w, t.warning),
                  ) ??
                  []),
          ],
        );
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
        _buildSectionTitle(t, "Q&A Transcript", FeatherIcons.messageSquare),
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
          color: isQuestion ? t.primary : t.textSecondary,
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

  Widget _buildSectionTitle(AppThemeColors t, String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 20, color: t.primary),
        const SizedBox(width: 10),
        Text(
          title,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: t.text,
          ),
        ),
      ],
    );
  }

  Widget _buildMetricRow(
    AppThemeColors t,
    String label,
    String value,
    Color color,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: t.textSecondary)),
          Text(
            value,
            style: TextStyle(fontWeight: FontWeight.bold, color: color),
          ),
        ],
      ),
    );
  }

  Widget _buildBulletPoint(AppThemeColors t, String text, Color color) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(top: 6),
            width: 8,
            height: 8,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 14,
                color: t.textSecondary,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class RadarChartPainter extends CustomPainter {
  final AppThemeColors t;
  final List<double> data; // values 0.0 to 1.0
  final List<String> labels;

  RadarChartPainter({
    required this.t,
    required this.data,
    required this.labels,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = min(size.width, size.height) / 2;
    final angleStep = (2 * pi) / data.length;

    // 1. Draw Background Grid (Concentric Pentagons/Polygons)
    final gridPaint = Paint()
      ..color = t.border.withValues(alpha: 0.2)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    for (var i = 1; i <= 4; i++) {
      final r = radius * (i / 4);
      final path = Path();
      for (var j = 0; j < data.length; j++) {
        final angle = j * angleStep - (pi / 2);
        final point = Offset(
          center.dx + r * cos(angle),
          center.dy + r * sin(angle),
        );
        if (j == 0) {
          path.moveTo(point.dx, point.dy);
        } else {
          path.lineTo(point.dx, point.dy);
        }
      }
      path.close();
      canvas.drawPath(path, gridPaint);
    }

    // 2. Draw Axis Lines
    for (var i = 0; i < data.length; i++) {
      final angle = i * angleStep - (pi / 2);
      canvas.drawLine(
        center,
        Offset(
          center.dx + radius * cos(angle),
          center.dy + radius * sin(angle),
        ),
        gridPaint,
      );

      // Labels
      final labelOffset = Offset(
        center.dx + (radius + 20) * cos(angle),
        center.dy + (radius + 15) * sin(angle),
      );
      _drawText(canvas, labels[i], labelOffset, t);
    }

    // 3. Draw Data Polygon
    final dataPath = Path();
    for (var i = 0; i < data.length; i++) {
      final r = radius * data[i];
      final angle = i * angleStep - (pi / 2);
      final point = Offset(
        center.dx + r * cos(angle),
        center.dy + r * sin(angle),
      );
      if (i == 0) {
        dataPath.moveTo(point.dx, point.dy);
      } else {
        dataPath.lineTo(point.dx, point.dy);
      }
    }
    dataPath.close();

    final fillPaint = Paint()
      ..shader = RadialGradient(
        colors: [
          t.primary.withValues(alpha: 0.4),
          t.primary.withValues(alpha: 0.1),
        ],
      ).createShader(Rect.fromCircle(center: center, radius: radius))
      ..style = PaintingStyle.fill;

    final outlinePaint = Paint()
      ..color = t.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0
      ..maskFilter = const MaskFilter.blur(BlurStyle.solid, 2);

    canvas.drawPath(dataPath, fillPaint);
    canvas.drawPath(dataPath, outlinePaint);

    // Draw dots at vertices
    final dotPaint = Paint()
      ..color = t.primary
      ..style = PaintingStyle.fill;
    for (var i = 0; i < data.length; i++) {
      final r = radius * data[i];
      final angle = i * angleStep - (pi / 2);
      canvas.drawCircle(
        Offset(center.dx + r * cos(angle), center.dy + r * sin(angle)),
        4,
        dotPaint,
      );
    }
  }

  void _drawText(Canvas canvas, String text, Offset offset, AppThemeColors t) {
    final span = TextSpan(
      style: TextStyle(
        color: t.textSecondary,
        fontSize: 11,
        fontWeight: FontWeight.bold,
      ),
      text: text,
    );
    final tp = TextPainter(
      text: span,
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
    );
    tp.layout();
    tp.paint(canvas, offset - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(covariant RadarChartPainter oldDelegate) =>
      oldDelegate.data != data ||
      oldDelegate.labels != labels ||
      oldDelegate.t != t;
}
