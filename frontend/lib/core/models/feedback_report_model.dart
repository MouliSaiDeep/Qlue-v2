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
      // FE-BUG #7 FIX: use safe parser instead of direct cast which throws on null/List
      dimensionScores: _parseDimensionScores(json['dimensionScores']),
      strengths: List<String>.from(json['strengths'] ?? []),
      // Handle both 'weaknesses' and 'improvements' keys from backend
      weaknesses: List<String>.from(json['weaknesses'] ?? json['improvements'] ?? []),
      recommendations: List<String>.from(json['recommendations'] ?? []),
      executiveSummary: json['executiveSummary'] ?? 'No summary available.',
      transcript: transcript,
    );
  }

  static Map<String, double> _parseDimensionScores(dynamic data) {
    if (data == null) return {};
    if (data is! Map) return {};
    final result = <String, double>{};
    (data as Map).forEach((key, value) {
      if (value is num) {
        result[key.toString()] = value.toDouble();
      }
    });
    return result;
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
