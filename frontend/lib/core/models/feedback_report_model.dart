class FeedbackReportModel {
  final String sessionId;
  final double overallScore;
  final Map<String, double> dimensionScores;
  final List<String> strengths;
  final List<String> weaknesses;
  final List<String> recommendations;
  final String executiveSummary;
  final List<TranscriptEntry> transcript;

  FeedbackReportModel({
    required this.sessionId,
    required this.overallScore,
    required this.dimensionScores,
    required this.strengths,
    required this.weaknesses,
    required this.recommendations,
    required this.executiveSummary,
    this.transcript = const [],
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
      dimensionScores: (json['dimensionScores'] as Map<String, dynamic>?)?.map(
        (key, value) => MapEntry(key, (value as num).toDouble()),
      ) ?? {},
      strengths: List<String>.from(json['strengths'] ?? []),
      // Handle both 'weaknesses' and 'improvements' keys from backend
      weaknesses: List<String>.from(json['weaknesses'] ?? json['improvements'] ?? []),
      recommendations: List<String>.from(json['recommendations'] ?? []),
      executiveSummary: json['executiveSummary'] ?? 'No summary available.',
      transcript: transcript,
    );
  }
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
