import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/screens/interview/interview_transcript.dart';

void main() {
  testWidgets(
    'growing and revised hypotheses keep layout and scroll owner stable',
    (tester) async {
      Future<void> show(String text) => tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                const SizedBox(key: Key('sphere'), height: 160),
                LiveTranscriptViewport(text: text),
                const Text('Listening', key: Key('status')),
              ],
            ),
          ),
        ),
      );
      await show('');
      final spherePosition = tester.getTopLeft(find.byKey(const Key('sphere')));
      final statusPosition = tester.getTopLeft(find.byKey(const Key('status')));
      final state = tester.state(find.byType(LiveTranscriptViewport));
      final longText = List.filled(
        100,
        'software development Flutter AWS',
      ).join(' ');
      await show(longText);
      await tester.pump();
      expect(
        tester.getTopLeft(find.byKey(const Key('sphere'))),
        spherePosition,
      );
      expect(
        tester.getTopLeft(find.byKey(const Key('status'))),
        statusPosition,
      );
      expect(tester.state(find.byType(LiveTranscriptViewport)), same(state));
      final scroll = tester.state<ScrollableState>(find.byType(Scrollable));
      expect(scroll.position.pixels, scroll.position.maxScrollExtent);
      await show('$longText revised ending');
      await tester.pump();
      expect(
        tester.getTopLeft(find.byKey(const Key('status'))),
        statusPosition,
      );
      expect(scroll.position.pixels, scroll.position.maxScrollExtent);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('manual review of earlier text is not overridden by new words', (
    tester,
  ) async {
    final longText = List.filled(100, 'project and achievement').join(' ');
    Future<void> show(String text) => tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: LiveTranscriptViewport(text: text)),
      ),
    );
    await show('');
    await show(longText);
    await tester.pump();
    await tester.drag(find.byType(SingleChildScrollView), const Offset(0, 70));
    await tester.pumpAndSettle();
    final scroll = tester.state<ScrollableState>(find.byType(Scrollable));
    final offset = scroll.position.pixels;
    expect(scroll.position.extentAfter, greaterThan(24));
    await show('$longText new sentence');
    await tester.pump();
    expect(scroll.position.pixels, offset);
  });
}
