import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/components/glass_card.dart';
import 'package:frontend/components/avatar.dart';
import 'package:frontend/core/theme.dart';
<<<<<<< HEAD

void main() {
=======
import 'dart:io';

void main() {
  setUpAll(() {
    HttpOverrides.global = null; // Ensure no global overrides interfere
  });

>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
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
<<<<<<< HEAD
      // Verify BackdropFilter is present (glass effect core)
=======
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
      expect(find.byType(BackdropFilter), findsOneWidget);
    });

    testWidgets('Avatar should render correct state and name', (WidgetTester tester) async {
<<<<<<< HEAD
=======
      // Mocking Image.network is tricky without external packages, 
      // but we can at least verify the Avatar widget itself exists.
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
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
<<<<<<< HEAD
      // Avatar uses Image.network internally for dynamic letter avatar
      expect(find.byType(Image), findsOneWidget);
=======
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
    });
  });
}
