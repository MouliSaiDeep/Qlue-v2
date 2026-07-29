import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/models/feedback_report_model.dart';
import 'package:frontend/screens/interview/feedback_pdf_export.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('FeedbackPdfBuilder produces a non-empty PDF', () async {
    final report = FeedbackReportModel(
      sessionId: 's1',
      overallScore: 82,
      dimensionScores: {
        'Clarity': 88,
        'Fluency': 74,
        'Vocabulary': 91,
        'Structure': 60,
        'Confidence': 45,
      },
      strengths: [
        'Clear and structured answers with concrete examples.',
        'Strong domain vocabulary.',
      ],
      weaknesses: [
        'Occasionally spoke too fast under pressure.',
        'Could quantify impact more.',
      ],
      recommendations: const [],
      executiveSummary:
          'A solid interview overall. You communicated your experience well '
          'and handled follow-ups with composure.',
      transcript: [
        TranscriptEntry(
          role: 'AI',
          text: 'Tell me about a challenging project you led.',
          timestamp: DateTime(2026, 1, 1),
        ),
        TranscriptEntry(
          role: 'USER',
          text: 'I led a migration of our billing system to a serverless '
              'architecture, cutting costs by 40%.',
          timestamp: DateTime(2026, 1, 1),
        ),
      ],
    );

    final bytes = await FeedbackPdfBuilder.build(
      report: report,
      topic: 'Backend Engineer Mock Interview',
      userName: 'Alex Doe',
      role: 'Backend Engineer',
      overallScore: 82,
    );

    expect(bytes.lengthInBytes, greaterThan(1000));
    // PDF files start with the "%PDF" magic bytes.
    expect(String.fromCharCodes(bytes.sublist(0, 4)), '%PDF');
  });

  test('FeedbackPdfBuilder paginates a long transcript without crashing',
      () async {
    final transcript = <TranscriptEntry>[];
    for (var i = 0; i < 40; i++) {
      transcript.add(TranscriptEntry(
        role: i.isEven ? 'AI' : 'USER',
        text: 'This is turn number $i with enough text to take up a good '
            'amount of vertical space so the transcript spills across '
            'multiple PDF pages and exercises the pagination path. '
            'It also includes a smart quote ’ and an em-dash — to '
            'verify Unicode glyphs render.',
        timestamp: DateTime(2026, 1, 1),
      ));
    }

    final report = FeedbackReportModel(
      sessionId: 's3',
      overallScore: 55,
      dimensionScores: {'Clarity': 55, 'Fluency': 60, 'Depth': 50},
      strengths: const ['Good.'],
      weaknesses: const ['Improve.'],
      recommendations: const [],
      executiveSummary: 'Long transcript test.',
      transcript: transcript,
    );

    final bytes = await FeedbackPdfBuilder.build(
      report: report,
      topic: 'Long Interview',
      userName: 'Alex Doe',
      role: 'Engineer',
      overallScore: 55,
    );

    expect(bytes.lengthInBytes, greaterThan(1000));
  });

  test('FeedbackPdfBuilder handles empty report gracefully', () async {
    final report = FeedbackReportModel(
      sessionId: 's2',
      overallScore: 0,
      dimensionScores: const {},
      strengths: const [],
      weaknesses: const [],
      recommendations: const [],
      executiveSummary: '',
    );

    final bytes = await FeedbackPdfBuilder.build(
      report: report,
      topic: 'Interview Feedback',
      userName: 'User',
      role: 'Candidate',
      overallScore: 0,
    );

    expect(bytes.lengthInBytes, greaterThan(1000));
  });
}
