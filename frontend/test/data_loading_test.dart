import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/components/data_loading.dart';
import 'package:frontend/core/theme.dart';

void main() {
  for (final colors in [AppThemeColors.dark, AppThemeColors.light]) {
    for (final dashboard in [true, false]) {
      testWidgets(
        'static skeleton at narrow width, dark=${colors.isDark}, dashboard=$dashboard',
        (tester) async {
          await tester.binding.setSurfaceSize(const Size(320, 640));
          addTearDown(() => tester.binding.setSurfaceSize(null));
          final semantics = tester.ensureSemantics();
          await tester.pumpWidget(
            AppThemeColorsProvider(
              colors: colors,
              child: MaterialApp(
                home: Scaffold(
                  body: SingleChildScrollView(
                    child: DataLoadingSkeleton(
                      label: 'Loading data',
                      dashboard: dashboard,
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.bySemanticsLabel('Loading data'), findsOneWidget);
          expect(find.byType(Text), findsNothing);
          expect(tester.binding.hasScheduledFrame, isFalse);
          expect(tester.takeException(), isNull);
          semantics.dispose();
        },
      );
    }
  }

  testWidgets('load failure exposes one explicit retry action', (tester) async {
    var retries = 0;
    await tester.pumpWidget(
      AppThemeColorsProvider(
        colors: AppThemeColors.dark,
        child: MaterialApp(
          home: Scaffold(
            body: DataLoadError(
              message: 'Failed to load history.',
              onRetry: () => retries++,
            ),
          ),
        ),
      ),
    );
    expect(find.text('Failed to load history.'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retries, 1);
    expect(find.byType(DataLoadingSkeleton), findsNothing);
  });
}
