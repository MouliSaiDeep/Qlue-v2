class FeedbackReportModel {
  final String sessionId;
  final double overallScore;
  final Map<String, double> dimensionScores;
  final List<String> strengths;
  final List<String> weaknesses;
  final List<String> recommendations;
  final String executiveSummary;
  final List<TranscriptEntry> transcript;
  final List<ScoreExplanation> scoreExplanations;
  final String? assessmentScope;
  final int? assessedAnswers;
  final double? practiceBaseline;
  final List<double> answerScores;

  FeedbackReportModel({
    required this.sessionId,
    required this.overallScore,
    required this.dimensionScores,
    required this.strengths,
    required this.weaknesses,
    required this.recommendations,
    required this.executiveSummary,
    this.transcript = const [],
    this.scoreExplanations = const [],
    this.assessmentScope,
    this.assessedAnswers,
    this.practiceBaseline,
    this.answerScores = const [],
  });

  factory FeedbackReportModel.fromJson(Map<String, dynamic> json) {
    // Parse transcript if available
    List<TranscriptEntry> transcript = [];
    if (json['transcript'] != null) {
      transcript = (json['transcript'] as List).map((item) {
        return TranscriptEntry(
          role: item['speaker'] ?? 'UNKNOWN',
          text: item['text'] ?? '',
          timestamp: item['timestamp'] != null
              ? DateTime.parse(item['timestamp'])
              : DateTime.now(),
          turnIndex: item['turnIndex'] ?? 0,
        );
      }).toList();
    }

    return FeedbackReportModel(
      sessionId: json['sessionId'] ?? '',
      overallScore: (json['overallScore'] ?? 0).toDouble(),
      // FE-BUG #7 FIX: use safe parser instead of direct cast which throws on null/List
      dimensionScores: _parseDimensionScores(json['dimensionScores']),
      strengths: List<String>.from(json['strengths'] ?? []),
      // Handle both 'weaknesses' and 'improvements' keys from backend
      weaknesses: List<String>.from(
        json['weaknesses'] ?? json['improvements'] ?? [],
      ),
      recommendations: List<String>.from(json['recommendations'] ?? []),
      executiveSummary: json['executiveSummary'] ?? 'No summary available.',
      transcript: transcript,
      scoreExplanations:
          (json['scoreExplanations'] is List
                  ? json['scoreExplanations'] as List
                  : const [])
              .whereType<Map>()
              .map(
                (e) => ScoreExplanation.fromJson(Map<String, dynamic>.from(e)),
              )
              .toList(),
      assessmentScope: json['assessment']?['scope'] as String?,
      practiceBaseline:
          (json['assessment']?['practiceProgress']?['baseline'] as num?)
              ?.toDouble(),
      answerScores: _answerScores(json['assessment']),
      assessedAnswers: json['assessment']?['scope'] == 'FINAL_INTRODUCTION'
          ? 1
          : (json['assessment']?['answers'] as List?)?.length,
    );
  }

  static List<double> _answerScores(dynamic assessment) {
    if (assessment is! Map || assessment['scope'] == 'FINAL_INTRODUCTION') {
      return [];
    }
    final rubric = assessment['rubric'];
    final answers = assessment['answers'];
    if (rubric is! List || answers is! List || rubric.length != 4) return [];
    final weights = rubric.map((r) => r is Map ? r['weight'] : null).toList();
    if (weights.any((w) => w is! num || !w.isFinite || w < 0) ||
        weights.fold<double>(0, (a, w) => a + (w as num)) != 100) {
      return [];
    }
    final scores = <double>[];
    for (final a in answers) {
      final levels = a is Map ? a['levels'] : null;
      if (levels is! List ||
          levels.length != 4 ||
          levels.any((n) => n is! int || n < 0 || n > 4)) {
        return [];
      }
      var score = 0.0;
      for (var i = 0; i < 4; i++) {
        score += (weights[i] as num) * (levels[i] as int) / 4;
      }
      scores.add((score * 10).roundToDouble() / 10);
    }
    return scores;
  }

  static Map<String, double> _parseDimensionScores(dynamic data) {
    if (data == null) return {};
    if (data is! Map) return {};
    final result = <String, double>{};
    data.forEach((key, value) {
      if (value is num) {
        result[key.toString()] = value.toDouble();
      }
    });
    return result;
  }
}

class ScoreExplanation {
  final String label;
  final double weight;
  final String reason;
  final List<String> evidence;
  final String improvement;
  const ScoreExplanation({
    required this.label,
    required this.weight,
    required this.reason,
    this.evidence = const [],
    this.improvement = '',
  });
  factory ScoreExplanation.fromJson(Map<String, dynamic> json) =>
      ScoreExplanation(
        label: json['label'] as String? ?? '',
        weight: (json['weight'] as num?)?.toDouble() ?? 0,
        reason: json['reason'] as String? ?? '',
        evidence:
            (json['evidence'] is List ? json['evidence'] as List : const [])
                .whereType<Map>()
                .map((e) => e['quote'])
                .whereType<String>()
                .where((quote) => quote.trim().isNotEmpty)
                .toList(),
        improvement: json['improvement'] as String? ?? '',
      );
}

class TranscriptEntry {
  final String role;
  final String text;
  final DateTime timestamp;
  final int turnIndex;

  TranscriptEntry({
    required this.role,
    required this.text,
    required this.timestamp,
    this.turnIndex = 0,
  });
}
