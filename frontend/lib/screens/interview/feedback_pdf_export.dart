import 'dart:math';
import 'dart:typed_data';
import 'package:flutter/services.dart' show rootBundle;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import '../../core/models/feedback_report_model.dart';

/// Builds a light-mode PDF that mirrors the FeedbackReportScreen UI:
/// header, overall-score card with a semicircle gauge, a dimension-breakdown
/// card (radar chart + per-dimension bars), the Summary / Strengths /
/// Weaknesses sections (all expanded, not tabbed), and the Q&A transcript.
///
/// The on-screen report is forced dark; here everything is rendered on white
/// with the app's light palette so the export reads as a clean printable page.
class FeedbackPdfBuilder {
  // Light palette (mirrors AppThemeColors.light).
  static const _text = PdfColor.fromInt(0xFF000000);
  static const _textSecondary = PdfColor.fromInt(0xFF525252);
  static const _textTertiary = PdfColor.fromInt(0xFFA1A1AA);
  static const _primary = PdfColor.fromInt(0xFF305148);
  static const _success = PdfColor.fromInt(0xFF1D9D54);
  static const _warning = PdfColor.fromInt(0xFFB4700A);
  static const _border = PdfColor.fromInt(0xFFE5E5E5);
  static const _cardFill = PdfColor.fromInt(0xFFFCFCFD);
  static const _track = PdfColor.fromInt(0xFFE5E7EB);

  // Score colors — same thresholds as the screen (_scoreColor), nudged a
  // touch darker so they stay legible on white paper.
  static PdfColor _scoreColor(num score) {
    if (score >= 75) return const PdfColor.fromInt(0xFF16A34A); // green
    if (score >= 50) return const PdfColor.fromInt(0xFFD97706); // amber
    return const PdfColor.fromInt(0xFFDC2626); // red
  }

  static Future<Uint8List> build({
    required FeedbackReportModel report,
    required String topic,
    required String userName,
    required String role,
    required int overallScore,
  }) async {
    final doc = pw.Document(
      title: 'Qlue Feedback — $topic',
      author: 'Qlue AI',
    );

    final score = overallScore;
    final scoreColor = _scoreColor(score);

    // Dimensions sorted high→low (mirrors the screen).
    final dims = report.dimensionScores.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    // Embed Montserrat (bundled with the app) so smart quotes, em-dashes and
    // accented characters in AI summaries/transcripts render correctly and the
    // PDF matches the app's typography. Falls back to Helvetica if unavailable.
    pw.ThemeData theme;
    try {
      final regular =
          pw.Font.ttf(await rootBundle.load('assets/fonts/Montserrat-Regular.ttf'));
      final bold =
          pw.Font.ttf(await rootBundle.load('assets/fonts/Montserrat-Bold.ttf'));
      theme = pw.ThemeData.withFont(base: regular, bold: bold);
    } catch (_) {
      theme = pw.ThemeData.withFont();
    }

    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        theme: theme,
        margin: const pw.EdgeInsets.fromLTRB(28, 30, 28, 28),
        header: (ctx) => ctx.pageNumber == 1
            ? _header(topic)
            : pw.SizedBox(height: 0),
        footer: (ctx) => _footer(ctx),
        build: (ctx) => [
          _scoreCard(userName, role, score, scoreColor),
          pw.SizedBox(height: 16),
          _dimensionCard(dims),
          pw.SizedBox(height: 16),
          _summarySection(report),
          pw.SizedBox(height: 16),
          _strengthsSection(report),
          pw.SizedBox(height: 16),
          _weaknessesSection(report),
          pw.SizedBox(height: 16),
          // Spread (not a single card) so a long transcript paginates instead
          // of overflowing one page — a decorated Container can't page-split.
          ..._transcriptWidgets(report),
        ],
      ),
    );

    return doc.save();
  }

  // ---------------------------------------------------------------- header

  static pw.Widget _header(String topic) {
    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  'PERFORMANCE ANALYSIS',
                  style: pw.TextStyle(
                    fontSize: 10,
                    color: _textTertiary,
                    fontWeight: pw.FontWeight.bold,
                    letterSpacing: 1.2,
                  ),
                ),
                pw.SizedBox(height: 2),
                pw.Text(
                  topic,
                  style: pw.TextStyle(
                    fontSize: 20,
                    color: _text,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              ],
            ),
            pw.Text(
              'Qlue AI',
              style: pw.TextStyle(
                fontSize: 13,
                color: _primary,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
          ],
        ),
        pw.SizedBox(height: 12),
        pw.Divider(color: _border, thickness: 1, height: 1),
        pw.SizedBox(height: 16),
      ],
    );
  }

  static pw.Widget _footer(pw.Context ctx) {
    return pw.Padding(
      padding: const pw.EdgeInsets.only(top: 8),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Text(
            'Generated by Qlue AI',
            style: const pw.TextStyle(fontSize: 8, color: _textTertiary),
          ),
          pw.Text(
            'Page ${ctx.pageNumber} of ${ctx.pagesCount}',
            style: const pw.TextStyle(fontSize: 8, color: _textTertiary),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------- card shell

  static pw.Widget _card({required pw.Widget child, double padding = 16}) {
    return pw.Container(
      width: double.infinity,
      padding: pw.EdgeInsets.all(padding),
      decoration: pw.BoxDecoration(
        color: _cardFill,
        borderRadius: pw.BorderRadius.circular(14),
        border: pw.Border.all(color: _border, width: 1),
      ),
      child: child,
    );
  }

  static pw.Widget _sectionTitle(String title) {
    return pw.Row(
      children: [
        pw.Container(width: 4, height: 16, color: _primary),
        pw.SizedBox(width: 8),
        pw.Text(
          title,
          style: pw.TextStyle(
            fontSize: 15,
            fontWeight: pw.FontWeight.bold,
            color: _text,
          ),
        ),
      ],
    );
  }

  // ------------------------------------------------------------- score card

  static pw.Widget _scoreCard(
    String name,
    String role,
    int score,
    PdfColor scoreColor,
  ) {
    final badge = score >= 80
        ? 'Top 15% of candidates'
        : score >= 50
            ? 'Solid performance'
            : 'Keep practicing!';

    return _card(
      padding: 18,
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.center,
        children: [
          pw.Expanded(
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  name,
                  maxLines: 1,
                  overflow: pw.TextOverflow.clip,
                  style: pw.TextStyle(
                    fontSize: 18,
                    fontWeight: pw.FontWeight.bold,
                    color: _text,
                  ),
                ),
                pw.SizedBox(height: 3),
                pw.Text(
                  role,
                  style: const pw.TextStyle(
                    fontSize: 12,
                    color: _textSecondary,
                  ),
                ),
                pw.SizedBox(height: 10),
                pw.Container(
                  padding: const pw.EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: pw.BoxDecoration(
                    color: PdfColor(
                      scoreColor.red,
                      scoreColor.green,
                      scoreColor.blue,
                      0.10,
                    ),
                    borderRadius: pw.BorderRadius.circular(12),
                    border: pw.Border.all(
                      color: PdfColor(
                        scoreColor.red,
                        scoreColor.green,
                        scoreColor.blue,
                        0.35,
                      ),
                    ),
                  ),
                  child: pw.Text(
                    badge,
                    style: pw.TextStyle(
                      fontSize: 10,
                      fontWeight: pw.FontWeight.bold,
                      color: scoreColor,
                    ),
                  ),
                ),
              ],
            ),
          ),
          pw.SizedBox(width: 12),
          _gauge(score, scoreColor),
        ],
      ),
    );
  }

  static pw.Widget _gauge(int score, PdfColor color) {
    const w = 150.0;
    const h = 84.0;
    return pw.SizedBox(
      width: w,
      height: h,
      child: pw.Stack(
        alignment: pw.Alignment.bottomCenter,
        children: [
          pw.CustomPaint(
            size: const PdfPoint(w, h),
            painter: (canvas, size) {
              final cx = size.x / 2;
              final cy = 12.0;
              final r = size.x / 2 - 14;
              canvas
                ..setLineCap(PdfLineCap.round)
                ..setLineWidth(11);
              // Track (full semicircle, left→right over the top).
              _strokeArc(canvas, cx, cy, r, pi, 0, _track);
              // Progress fills from the left as the score rises.
              final end = pi - (score / 100).clamp(0.0, 1.0) * pi;
              _strokeArc(canvas, cx, cy, r, pi, end, color);
            },
          ),
          pw.Padding(
            padding: const pw.EdgeInsets.only(bottom: 10),
            child: pw.Column(
              mainAxisSize: pw.MainAxisSize.min,
              children: [
                pw.Text(
                  '$score',
                  style: pw.TextStyle(
                    fontSize: 26,
                    fontWeight: pw.FontWeight.bold,
                    color: color,
                  ),
                ),
                pw.Text(
                  'OVERALL',
                  style: const pw.TextStyle(
                    fontSize: 7,
                    letterSpacing: 1.5,
                    color: _textTertiary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Draws an arc as a polyline (PdfGraphics has no arc primitive). PDF space
  /// is y-up, so +sin points upward — a top semicircle, matching the screen.
  static void _strokeArc(
    PdfGraphics canvas,
    double cx,
    double cy,
    double r,
    double a0,
    double a1,
    PdfColor color,
  ) {
    const seg = 48;
    canvas.setStrokeColor(color);
    for (var i = 0; i <= seg; i++) {
      final t = a0 + (a1 - a0) * i / seg;
      final x = cx + r * cos(t);
      final y = cy + r * sin(t);
      if (i == 0) {
        canvas.moveTo(x, y);
      } else {
        canvas.lineTo(x, y);
      }
    }
    canvas.strokePath();
  }

  // --------------------------------------------------------- dimension card

  static pw.Widget _dimensionCard(List<MapEntry<String, double>> dims) {
    // Chart uses the top 3 dimensions (mirrors the screen), padded if needed.
    var chart = dims.take(3).toList();
    if (chart.isEmpty) {
      chart = [
        const MapEntry('Clarity', 80),
        const MapEntry('Fluency', 70),
        const MapEntry('Vocabulary', 90),
      ];
    }
    while (chart.length < 3) {
      chart.add(MapEntry('Metric ${chart.length + 1}', 80));
    }
    final data = chart.map((e) => (e.value / 100).clamp(0.0, 1.0)).toList();
    final labels = chart.map((e) => e.key).toList();
    final barDims = dims.isEmpty ? chart : dims;

    return _card(
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text(
            'Dimension Breakdown',
            style: pw.TextStyle(
              fontSize: 15,
              fontWeight: pw.FontWeight.bold,
              color: _text,
            ),
          ),
          pw.SizedBox(height: 14),
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.center,
            children: [
              _radar(data, labels),
              pw.SizedBox(width: 16),
              pw.Expanded(
                child: pw.Column(
                  children: barDims
                      .map((d) => _dimensionBar(d.key, d.value.toDouble()))
                      .toList(),
                ),
              ),
            ],
          ),
          if (dims.length >= 2) ...[
            pw.SizedBox(height: 10),
            pw.Text(
              'Strongest: ${dims.first.key}   ·   Focus next: ${dims.last.key}',
              style: const pw.TextStyle(fontSize: 10, color: _textSecondary),
            ),
          ],
        ],
      ),
    );
  }

  static pw.Widget _dimensionBar(String label, double value) {
    final v = value.round().clamp(0, 100);
    final barColor = _scoreColor(v);
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 9),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: [
              pw.Expanded(
                child: pw.Text(
                  label,
                  maxLines: 1,
                  overflow: pw.TextOverflow.clip,
                  style: const pw.TextStyle(
                    fontSize: 10,
                    color: _textSecondary,
                  ),
                ),
              ),
              pw.Text(
                '$v',
                style: pw.TextStyle(
                  fontSize: 10,
                  fontWeight: pw.FontWeight.bold,
                  color: _text,
                ),
              ),
            ],
          ),
          pw.SizedBox(height: 4),
          pw.ClipRRect(
            horizontalRadius: 3,
            verticalRadius: 3,
            child: pw.Container(
              height: 5,
              color: _track,
              child: pw.Row(
                children: [
                  pw.Expanded(
                    flex: v < 1 ? 1 : v,
                    child: pw.Container(color: barColor),
                  ),
                  pw.Expanded(
                    flex: (100 - v) < 1 ? 1 : (100 - v),
                    child: pw.SizedBox(),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static pw.Widget _radar(List<double> data, List<String> labels) {
    const s = 150.0;
    return pw.SizedBox(
      width: s,
      height: s,
      child: pw.Stack(
        children: [
          pw.CustomPaint(
            size: const PdfPoint(s, s),
            painter: (canvas, size) {
              final cx = size.x / 2;
              final cy = size.y / 2;
              final radius = min(size.x, size.y) / 2 - 26;
              final n = data.length;
              final step = 2 * pi / n;
              // y-up: subtract sin so the first vertex sits at the TOP.
              double px(double ang, double rr) => cx + rr * cos(ang);
              double py(double ang, double rr) => cy - rr * sin(ang);

              // Grid rings.
              canvas
                ..setLineWidth(0.8)
                ..setStrokeColor(_track);
              for (var ring = 1; ring <= 4; ring++) {
                final rr = radius * ring / 4;
                for (var j = 0; j <= n; j++) {
                  final ang = (j % n) * step + pi / 2;
                  final x = px(ang, rr);
                  final y = py(ang, rr);
                  if (j == 0) {
                    canvas.moveTo(x, y);
                  } else {
                    canvas.lineTo(x, y);
                  }
                }
                canvas.strokePath();
              }
              // Axes.
              for (var j = 0; j < n; j++) {
                final ang = j * step + pi / 2;
                canvas
                  ..moveTo(cx, cy)
                  ..lineTo(px(ang, radius), py(ang, radius))
                  ..strokePath();
              }
              // Data polygon fill.
              canvas.setFillColor(const PdfColor.fromInt(0xFFD1FADF));
              for (var j = 0; j <= n; j++) {
                final ang = (j % n) * step + pi / 2;
                final rr = radius * data[j % n];
                final x = px(ang, rr);
                final y = py(ang, rr);
                if (j == 0) {
                  canvas.moveTo(x, y);
                } else {
                  canvas.lineTo(x, y);
                }
              }
              canvas.fillPath();
              // Data polygon outline.
              canvas
                ..setStrokeColor(const PdfColor.fromInt(0xFF16A34A))
                ..setLineWidth(1.8);
              for (var j = 0; j <= n; j++) {
                final ang = (j % n) * step + pi / 2;
                final rr = radius * data[j % n];
                final x = px(ang, rr);
                final y = py(ang, rr);
                if (j == 0) {
                  canvas.moveTo(x, y);
                } else {
                  canvas.lineTo(x, y);
                }
              }
              canvas.strokePath();
              // Vertex dots.
              canvas.setFillColor(const PdfColor.fromInt(0xFF16A34A));
              for (var j = 0; j < n; j++) {
                final ang = j * step + pi / 2;
                final rr = radius * data[j];
                canvas.drawEllipse(px(ang, rr), py(ang, rr), 2.4, 2.4);
              }
              canvas.fillPath();
            },
          ),
          // Labels (n == 3): top-center, lower-right, lower-left.
          if (labels.isNotEmpty)
            pw.Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: pw.Center(child: _radarLabel(labels[0])),
            ),
          if (labels.length > 1)
            pw.Positioned(
              bottom: 14,
              right: 2,
              child: _radarLabel(labels[1]),
            ),
          if (labels.length > 2)
            pw.Positioned(
              bottom: 14,
              left: 2,
              child: _radarLabel(labels[2]),
            ),
        ],
      ),
    );
  }

  static pw.Widget _radarLabel(String text) {
    return pw.Text(
      text,
      style: pw.TextStyle(
        fontSize: 8,
        fontWeight: pw.FontWeight.bold,
        color: _textSecondary,
      ),
    );
  }

  // ------------------------------------------------------------- sections

  static pw.Widget _summarySection(FeedbackReportModel report) {
    return _card(
      padding: 18,
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          _sectionTitle('Executive Summary'),
          pw.SizedBox(height: 12),
          pw.Text(
            report.executiveSummary.isEmpty
                ? 'Your performance report is being processed.'
                : report.executiveSummary,
            style: const pw.TextStyle(
              fontSize: 12,
              lineSpacing: 3,
              color: _textSecondary,
            ),
          ),
          pw.SizedBox(height: 16),
          _metricRow('Confidence Level', 'High', _primary),
          pw.SizedBox(height: 8),
          _metricRow('Pace', 'Steady', _success),
        ],
      ),
    );
  }

  static pw.Widget _metricRow(String label, String value, PdfColor color) {
    return pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      children: [
        pw.Text(
          label,
          style: const pw.TextStyle(fontSize: 11, color: _textSecondary),
        ),
        pw.Text(
          value,
          style: pw.TextStyle(
            fontSize: 11,
            fontWeight: pw.FontWeight.bold,
            color: color,
          ),
        ),
      ],
    );
  }

  static pw.Widget _strengthsSection(FeedbackReportModel report) {
    final items = report.strengths.isEmpty
        ? ['Great effort in completing the session.']
        : report.strengths;
    return _card(
      padding: 18,
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          _sectionTitle('Your Strengths'),
          pw.SizedBox(height: 12),
          ...items.map((s) => _bullet(s, _success)),
        ],
      ),
    );
  }

  static pw.Widget _weaknessesSection(FeedbackReportModel report) {
    final items = report.weaknesses.isEmpty
        ? ['No major weaknesses identified.']
        : report.weaknesses;
    return _card(
      padding: 18,
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          _sectionTitle('Areas for Improvement'),
          pw.SizedBox(height: 12),
          ...items.map((w) => _bullet(w, _warning)),
        ],
      ),
    );
  }

  static pw.Widget _bullet(String text, PdfColor color) {
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 10),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Container(
            margin: const pw.EdgeInsets.only(top: 4),
            width: 6,
            height: 6,
            decoration: pw.BoxDecoration(
              color: color,
              shape: pw.BoxShape.circle,
            ),
          ),
          pw.SizedBox(width: 10),
          pw.Expanded(
            child: pw.Text(
              text,
              style: const pw.TextStyle(
                fontSize: 12,
                lineSpacing: 2,
                color: _textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Returns the transcript as a flat list of widgets (title + one card per
  /// turn) rather than a single card, so MultiPage can break between turns and
  /// long transcripts flow across pages without being clipped.
  static List<pw.Widget> _transcriptWidgets(FeedbackReportModel report) {
    final transcript = report.transcript;
    final widgets = <pw.Widget>[
      _sectionTitle('Q&A Transcript'),
      pw.SizedBox(height: 12),
    ];
    if (transcript.isEmpty) {
      widgets.add(
        pw.Text(
          'Transcript not available',
          style: const pw.TextStyle(fontSize: 11, color: _textTertiary),
        ),
      );
      return widgets;
    }
    for (var i = 0; i < transcript.length; i++) {
      final item = transcript[i];
      final isAI = item.role.toUpperCase() == 'AI';
      widgets.add(
        pw.Container(
          margin: const pw.EdgeInsets.only(bottom: 8),
          padding: const pw.EdgeInsets.all(10),
          decoration: pw.BoxDecoration(
            color: _cardFill,
            borderRadius: pw.BorderRadius.circular(8),
            border: pw.Border.all(color: _border, width: 0.8),
          ),
          child: _transcriptItem(item.text, isAI),
        ),
      );
    }
    return widgets;
  }

  static pw.Widget _transcriptItem(String text, bool isAI) {
    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Container(
          padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: pw.BoxDecoration(
            color: isAI
                ? const PdfColor(0.19, 0.32, 0.28, 0.10)
                : const PdfColor(0.32, 0.32, 0.32, 0.08),
            borderRadius: pw.BorderRadius.circular(4),
          ),
          child: pw.Text(
            isAI ? 'AI' : 'YOU',
            style: pw.TextStyle(
              fontSize: 8,
              fontWeight: pw.FontWeight.bold,
              color: isAI ? _primary : _textSecondary,
            ),
          ),
        ),
        pw.SizedBox(width: 10),
        pw.Expanded(
          child: pw.Text(
            text,
            style: const pw.TextStyle(
              fontSize: 11,
              lineSpacing: 2,
              color: _text,
            ),
          ),
        ),
      ],
    );
  }
}
