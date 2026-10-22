import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/voice_policy.dart';
import 'package:frontend/core/models/feedback_report_model.dart';

void main() {
  test('Ruth is default and old premium preferences cannot be selected', () {
    expect(VoicePolicy.resolve(null), 'Ruth');
    expect(VoicePolicy.resolve('Tiffany'), 'Ruth');
    expect(VoicePolicy.resolve('Matthew'), 'Matthew');
  });
  test('answer graph uses server rubric weights and bounded levels', () {
    final report = FeedbackReportModel.fromJson({
      'assessment': {
        'scope': 'ACCEPTED_ANSWERS',
        'rubric': [
          for (final w in [40, 20, 25, 15]) {'weight': w},
        ],
        'answers': [
          {
            'levels': [2, 3, 1, 4],
          },
          {
            'levels': [4, 4, 4, 4],
          },
        ],
      },
    });
    expect(report.answerScores, [56.3, 100]);
    expect(report.assessedAnswers, 2);
  });
}
