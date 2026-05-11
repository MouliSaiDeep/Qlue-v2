import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/models/dashboard_model.dart';
import 'package:frontend/core/models/session_model.dart';
import 'package:frontend/core/models/resume_model.dart';
import 'package:frontend/core/models/feedback_report_model.dart';

void main() {
  group('Model Serialization Tests', () {
    test('DashboardSummary.fromJson should parse correctly', () {
      final json = {
        'summary': {
          'totalSessions': 10,
          'completedSessions': 8,
          'averageScore': 75,
          'bestScore': 90,
          'moduleBreakdown': {'RESUME': 5},
          'latestFeedback': {
            'strengths': ['Comm'],
            'improvements': ['Speed'],
            'tip': 'Keep practicing'
          }
        }
      };

      final summary = DashboardSummary.fromJson(json);

      expect(summary.totalSessions, 10);
      expect(summary.averageScore, 75);
      expect(summary.strengths, contains('Comm'));
      expect(summary.tip, 'Keep practicing');
    });

    test('RadarData.fromJson should parse correctly and map labels', () {
      final json = {
        'radarData': {
          'RESUME': {
            'clarity': 80,
            'fluency': 70
          }
        }
      };

      final radar = RadarData.fromJson(json);
      final mapped = radar.getDimensionsForModule('RESUME');

      expect(mapped['Clarity'], 0.8);
      expect(mapped['Fluency'], 0.7);
    });

    test('SessionModel.fromJson should parse correctly', () {
      final json = {
        'sessionId': 's1',
        'userId': 'u1',
        'moduleType': 'HR',
        'startedAt': 123456789,
        'overallScore': 85.5
      };

      final session = SessionModel.fromJson(json);

      expect(session.sessionId, 's1');
      expect(session.score, 86); // Rounded
      expect(session.topic, 'Behavioral Skills');
    });

    test('ResumeModel.fromJson should parse correctly', () {
      final json = {
        'resumeId': 'r1',
        'fileName': 'resume.pdf',
        'fileSize': 1024,
        'status': 'parsed',
        'parsedData': {
          'skills': ['Dart', 'Flutter']
        },
        'updatedAt': '2026-05-11T12:00:00Z'
      };

      final resume = ResumeModel.fromJson(json);

      expect(resume.resumeId, 'r1');
      expect(resume.parsedData?.skills, contains('Dart'));
    });

    test('FeedbackReportModel.fromJson should parse correctly', () {
      final json = {
        'sessionId': 'f1',
        'overallScore': 88.0,
        'strengths': ['S1'],
        'weaknesses': ['W1']
      };

      final report = FeedbackReportModel.fromJson(json);

      expect(report.sessionId, 'f1');
      expect(report.overallScore, 88.0);
      expect(report.strengths, contains('S1'));
    });
  });
}
