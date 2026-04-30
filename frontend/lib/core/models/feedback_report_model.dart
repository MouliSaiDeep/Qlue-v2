class FeedbackReportModel {
  final String sessionId;
  final double overallScore;
  final Map<String, double> dimensionScores;
  final List<String> strengths;
  final List<String> weaknesses;
  final List<String> recommendations;
  final String executiveSummary;

  FeedbackReportModel({
    required this.sessionId,
    required this.overallScore,
    required this.dimensionScores,
    required this.strengths,
    required this.weaknesses,
    required this.recommendations,
    required this.executiveSummary,
  });

  factory FeedbackReportModel.fromJson(Map<String, dynamic> json) {
    return FeedbackReportModel(
      sessionId: json['sessionId'] ?? '',
      overallScore: (json['overallScore'] ?? 0).toDouble(),
      dimensionScores: (json['dimensionScores'] as Map<String, dynamic>?)?.map(
        (key, value) => MapEntry(key, (value as num).toDouble()),
      ) ?? {},
      strengths: List<String>.from(json['strengths'] ?? []),
      weaknesses: List<String>.from(json['weaknesses'] ?? []),
      recommendations: List<String>.from(json['recommendations'] ?? []),
      executiveSummary: json['executiveSummary'] ?? 'No summary available.',
    );
  }
}
