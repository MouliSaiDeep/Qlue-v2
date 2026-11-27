import 'package:intl/intl.dart';

enum SessionFeedbackStatus { generating, ready, unavailable }

class SessionModel {
  final String sessionId;
  final String userId;
  final String moduleType;
  final DateTime startedAt;
  final Map<String, dynamic>? accumulatedScores;
  final String? status;
  final SessionFeedbackStatus? feedbackStatus;
  final String? feedbackAttempt;
  final DateTime? feedbackActivityAt;

  SessionModel({
    required this.sessionId,
    required this.userId,
    required this.moduleType,
    required this.startedAt,
    this.accumulatedScores,
    this.status,
    this.feedbackStatus,
    this.feedbackAttempt,
    this.feedbackActivityAt,
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

    final eligible =
        json['feedbackExpected'] != false &&
        json['discarded'] != true &&
        json['answeredCount'] != 0;
    final feedbackId = json['feedbackId'];
    final feedbackStatus = eligible
        ? switch (json['feedbackStatus']) {
            'PENDING' => SessionFeedbackStatus.generating,
            'COMPLETE' => SessionFeedbackStatus.ready,
            'FAILED' => SessionFeedbackStatus.unavailable,
            _ when json['currentState'] == 'GENERATING_FEEDBACK' =>
              SessionFeedbackStatus.generating,
            _ when feedbackId is String && feedbackId.isNotEmpty =>
              SessionFeedbackStatus.ready,
            _ => null,
          }
        : null;
    final attempt = json['feedbackAttemptId'] ?? feedbackId;
    final activityTime = json['feedbackAttemptStartedAt'] ?? json['updatedAt'];
    return SessionModel(
      sessionId: json['sessionId'] ?? '',
      userId: json['userId'] ?? '',
      moduleType: json['moduleType'] ?? 'HR',
      startedAt: parseStartedAt(),
      accumulatedScores: json['accumulatedScores'] != null 
          ? Map<String, dynamic>.from(json['accumulatedScores']) 
          : null,
      status: json['status'] ?? json['currentState'],
      feedbackStatus: feedbackStatus,
      feedbackAttempt: attempt is String ? attempt : null,
      feedbackActivityAt: switch (activityTime) {
        final int millis => DateTime.fromMillisecondsSinceEpoch(millis),
        final String iso => DateTime.tryParse(iso),
        _ => null,
      },
    );
  }

  int get score {
    if (accumulatedScores == null || accumulatedScores!.isEmpty) return 0;
    int total = 0;
    int count = 0;
    // FE-BUG #16 FIX: Guard with `is num` before cast to prevent crash on non-numeric values
    accumulatedScores!.forEach((key, value) {
      if (value is num) {
        total += value.toInt();
        count++;
      } else if (value is String) {
        final parsed = int.tryParse(value);
        if (parsed != null) {
          total += parsed;
          count++;
        }
      }
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
