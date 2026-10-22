import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/screens/interview/widgets/feedback_radar_chart.dart';

void main() {
  Widget chart(Map<String, double> scores, ValueChanged<String> onSelected) =>
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 320,
              child: FeedbackRadarChart(
                scores: scores,
                accent: Colors.green,
                foreground: Colors.grey,
                pointColor: (_) => Colors.green,
                reduceMotion: true,
                onSelected: onSelected,
              ),
            ),
          ),
        ),
      );

  testWidgets(
    'tapping a scored point or an outer endpoint selects the matching criterion',
    (tester) async {
      final selections = <String>[];
      await tester.pumpWidget(
        chart({
          'Relevance': 75,
          'Specific Evidence': 50,
          'Structure': 25,
          'Clarity': 100,
        }, selections.add),
      );
      final origin = tester.getTopLeft(
        find.byKey(const Key('feedback-radar-plot')),
      );
      await tester.tapAt(origin + const Offset(204, 130));
      expect(selections.last, 'Specific Evidence');
      await tester.tapAt(origin + const Offset(160, 42));
      expect(selections.last, 'Relevance');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'zero scores retain selectable axes and sparse reports do not invent a polygon',
    (tester) async {
      final selections = <String>[];
      await tester.pumpWidget(
        chart({
          'Relevance': 0,
          'Evidence': 0,
          'Structure': 0,
          'Clarity': 0,
        }, selections.add),
      );
      final origin = tester.getTopLeft(
        find.byKey(const Key('feedback-radar-plot')),
      );
      await tester.tapAt(origin + const Offset(248, 130));
      expect(selections.last, 'Evidence');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(
        chart({'Relevance': 70, 'Evidence': 50}, selections.add),
      );
      expect(find.byKey(const Key('feedback-radar-plot')), findsNothing);
    },
  );
}
