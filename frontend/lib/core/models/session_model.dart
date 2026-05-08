import 'package:intl/intl.dart';

class SessionModel {
  final String sessionId;
  final String userId;
  final String moduleType;
  final DateTime startedAt;
  final Map<String, dynamic>? accumulatedScores;
  final String? status;

  SessionModel({
    required this.sessionId,
    required this.userId,
    required this.moduleType,
    required this.startedAt,
    this.accumulatedScores,
    this.status,
  });

  factory SessionModel.fromJson(Map<String, dynamic> json) {
    // Handle both 'startedAt' (millis) and 'startTime' (ISO string)
    DateTime parseStartedAt() {
      if (json['startedAt'] != null) {
        return DateTime.fromMillisecondsSinceEpoch(json['startedAt'] as int);
      }
      if (json['startTime'] != null) {
        return DateTime.parse(json['startTime'] as String);
      }
      return DateTime.fromMillisecondsSinceEpoch(0);
    }

    return SessionModel(
      sessionId: json['sessionId'] ?? '',
      userId: json['userId'] ?? '',
      moduleType: json['moduleType'] ?? 'HR',
      startedAt: parseStartedAt(),
      accumulatedScores: json['accumulatedScores'] != null 
          ? Map<String, dynamic>.from(json['accumulatedScores']) 
          : null,
      status: json['status'] ?? json['currentState'],
    );
  }

  int get score {
    if (accumulatedScores == null || accumulatedScores!.isEmpty) return 0;
    int total = 0;
    int count = 0;
    accumulatedScores!.forEach((key, value) {
      total += (value as num).toInt();
      count++;
    });
    return count > 0 ? (total / count).round() : 0;
  }

  String get topic {
    switch (moduleType.toUpperCase()) {
      case 'RESUME': return 'Resume Analysis';
      case 'HR': return 'Behavioral Skills';
      case 'WEBSITE': return 'Domain Knowledge';
      case 'INTRO': return 'Self Introduction';
      default: return 'Practice Session';
    }
  }

  String get dateText {
    final now = DateTime.now();
    final difference = now.difference(startedAt).inDays;
    
    if (difference == 0) return 'TODAY';
    if (difference == 1) return 'YESTERDAY';
    if (difference < 7) return '$difference DAYS AGO';
    return DateFormat('MMM d, yyyy').format(startedAt);
  }
}
