import 'dart:math' as math;

class DashboardSummary {
  final int totalSessions;
  final int completedSessions;
  final int averageScore;
  final int bestScore;
  final Map<String, int> moduleBreakdown;
  final List<String> strengths;
  final List<String> improvements;
  final String tip;

  DashboardSummary({
    required this.totalSessions,
    required this.completedSessions,
    required this.averageScore,
    required this.bestScore,
    required this.moduleBreakdown,
    this.strengths = const [],
    this.improvements = const [],
    this.tip = "",
  });

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    final summary = json['summary'] ?? {};
    final feedback = summary['latestFeedback'];
    return DashboardSummary(
      totalSessions: summary['totalSessions'] ?? 0,
      completedSessions: summary['completedSessions'] ?? 0,
      averageScore: summary['averageScore'] ?? 0,
      bestScore: summary['bestScore'] ?? 0,
      moduleBreakdown: Map<String, int>.from(summary['moduleBreakdown'] ?? {}),
      strengths: feedback != null ? List<String>.from(feedback['strengths'] ?? []) : [],
      improvements: feedback != null ? List<String>.from(feedback['improvements'] ?? []) : [],
      tip: feedback != null ? (feedback['tip'] ?? "") : "",
    );
  }

  factory DashboardSummary.initial() {
    return DashboardSummary(
      totalSessions: 0,
      completedSessions: 0,
      averageScore: 0,
      bestScore: 0,
      moduleBreakdown: {'RESUME': 0, 'HR': 0, 'WEBSITE': 0, 'INTRO': 0},
    );
  }
}

class RadarData {
  final Map<String, Map<String, int>> data;

  RadarData({required this.data});

  factory RadarData.fromJson(Map<String, dynamic> json) {
    final radar = json['radarData'] ?? {};
    Map<String, Map<String, int>> parsed = {};
    radar.forEach((mod, dims) {
      parsed[mod] = Map<String, int>.from(dims);
    });
    return RadarData(data: parsed);
  }

  factory RadarData.initial() {
    return RadarData(data: {});
  }

  Map<String, double> getDimensionsForModule(String module) {
    final modKey = module.toUpperCase();
    if (!data.containsKey(modKey) || data[modKey]!.isEmpty) {
      // Default placeholder radar data to keep UI beautiful even when empty
      return {
        "Comm": 0.0,
        "Tech": 0.0,
        "Logic": 0.0,
        "Fit": 0.0,
        "Conf": 0.0,
        "Lead": 0.0,
      };
    }

    Map<String, double> result = {};
    data[modKey]!.forEach((dim, score) {
      // Dimensions from backend are usually like "Communication", "Technical"
      // We map them to shorter keys for the Spider Chart UI
      String key = dim.substring(0, math.min(dim.length, 4));
      result[key] = score / 100.0;
    });
    return result;
  }
}
