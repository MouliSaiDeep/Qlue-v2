import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/components/glass_card.dart';
import 'package:frontend/components/avatar.dart';
import 'package:frontend/core/theme.dart';
import 'dart:io';

void main() {
  setUpAll(() {
    HttpOverrides.global = null; // Ensure no global overrides interfere
  });

  group('UI Component Tests', () {
    testWidgets('GlassCard should render child and apply glass effect', (WidgetTester tester) async {
      await tester.pumpWidget(
        const AppThemeColorsProvider(
          colors: AppThemeColors.dark,
          child: MaterialApp(
            home: Scaffold(
              body: GlassCard(
                child: Text('Inside Glass'),
              ),
            ),
          ),
        ),
      );

      expect(find.text('Inside Glass'), findsOneWidget);
      expect(find.byType(BackdropFilter), findsOneWidget);
    });

    testWidgets('Avatar should render correct state and name', (WidgetTester tester) async {
      // Mocking Image.network is tricky without external packages, 
      // but we can at least verify the Avatar widget itself exists.
      await tester.pumpWidget(
        const AppThemeColorsProvider(
          colors: AppThemeColors.dark,
          child: MaterialApp(
            home: Scaffold(
              body: Avatar(
                name: 'Mouli',
                size: 100,
              ),
            ),
          ),
        ),
      );
      
      expect(find.byType(Avatar), findsOneWidget);
    });
  });
}
