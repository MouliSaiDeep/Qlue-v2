import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:provider/provider.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart' as lg;
import 'package:frontend/components/glass_controls.dart';
import 'package:frontend/context/appearance_provider.dart';
import 'package:frontend/core/theme.dart';

// Confirms the App* control wrappers render in both appearances with no
// AdaptiveLiquidGlassLayer ancestor: Liquid falls back to defaults when no
// AppearanceProvider is present (headless-safe), Classic is forced via a
// stubbed provider.
class MockAppearance extends Mock implements AppearanceProvider {}

void main() {
  // Liquid: no provider -> _readAppearance falls back to liquid defaults.
  Widget liquidWrap(Widget child) => AppThemeColorsProvider(
        colors: AppThemeColors.dark,
        child: MaterialApp(home: Scaffold(body: Center(child: child))),
      );

  // Classic: a stubbed provider forces isLiquid == false.
  Widget classicWrap(Widget child) {
    final m = MockAppearance();
    when(() => m.isLiquid).thenReturn(false);
    when(() => m.glassIntensity).thenReturn(1.0);
    when(() => m.reduceMotion).thenReturn(false);
    return AppThemeColorsProvider(
      colors: AppThemeColors.dark,
      child: ChangeNotifierProvider<AppearanceProvider>.value(
        value: m,
        child: MaterialApp(home: Scaffold(body: Center(child: child))),
      ),
    );
  }

  group('App* controls render headless under Liquid', () {
    testWidgets('AppButton -> GlassButton', (tester) async {
      await tester.pumpWidget(
        liquidWrap(AppButton(label: 'Go', onTap: () {}, expand: false)),
      );
      expect(find.byType(lg.GlassButton), findsOneWidget);
    });

    testWidgets('AppChip -> GlassChip', (tester) async {
      await tester.pumpWidget(liquidWrap(const AppChip(label: 'Tag')));
      expect(find.byType(lg.GlassChip), findsOneWidget);
    });

    testWidgets('AppSlider -> GlassSlider', (tester) async {
      await tester.pumpWidget(liquidWrap(AppSlider(value: 0.5, onChanged: (_) {})));
      expect(find.byType(lg.GlassSlider), findsOneWidget);
    });

    testWidgets('AppSwitch -> GlassSwitch', (tester) async {
      await tester.pumpWidget(liquidWrap(AppSwitch(value: true, onChanged: (_) {})));
      expect(find.byType(lg.GlassSwitch), findsOneWidget);
    });

    testWidgets('AppIconButton -> GlassIconButton', (tester) async {
      await tester.pumpWidget(liquidWrap(AppIconButton(icon: Icons.close, onTap: () {})));
      expect(find.byType(lg.GlassIconButton), findsOneWidget);
    });
  });

  group('App* controls fall back to Material/normal under Classic', () {
    testWidgets('AppButton -> no GlassButton, shows label', (tester) async {
      await tester.pumpWidget(
        classicWrap(AppButton(label: 'Go', onTap: () {}, expand: false)),
      );
      expect(find.byType(lg.GlassButton), findsNothing);
      expect(find.text('Go'), findsOneWidget);
    });

    testWidgets('AppSlider -> Material Slider', (tester) async {
      await tester.pumpWidget(classicWrap(AppSlider(value: 0.5, onChanged: (_) {})));
      expect(find.byType(Slider), findsOneWidget);
      expect(find.byType(lg.GlassSlider), findsNothing);
    });

    testWidgets('AppSwitch -> Material Switch', (tester) async {
      await tester.pumpWidget(classicWrap(AppSwitch(value: true, onChanged: (_) {})));
      expect(find.byType(Switch), findsOneWidget);
      expect(find.byType(lg.GlassSwitch), findsNothing);
    });

    testWidgets('AppChip -> pill (no GlassChip)', (tester) async {
      await tester.pumpWidget(classicWrap(const AppChip(label: 'Tag', selected: true)));
      expect(find.byType(lg.GlassChip), findsNothing);
      expect(find.text('Tag'), findsOneWidget);
    });

    testWidgets('AppIconButton -> Material IconButton', (tester) async {
      await tester.pumpWidget(classicWrap(AppIconButton(icon: Icons.close, onTap: () {})));
      expect(find.byType(IconButton), findsOneWidget);
      expect(find.byType(lg.GlassIconButton), findsNothing);
    });
  });
}
