import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/app.dart';
import 'package:frontend/context/auth_provider.dart' as local;
import 'package:provider/provider.dart';
import 'package:mocktail/mocktail.dart';

class MockAuthProvider extends Mock implements local.AuthProvider {}

void main() {
  testWidgets('App smoke test - shows splash screen', (WidgetTester tester) async {
    final mockAuth = MockAuthProvider();
    
    when(() => mockAuth.isInitializing).thenReturn(true);
    when(() => mockAuth.isAuthenticated).thenReturn(false);
    when(() => mockAuth.addListener(any())).thenReturn(null);
    when(() => mockAuth.removeListener(any())).thenReturn(null);

    // Build our app and trigger a frame.
    await tester.pumpWidget(
      ChangeNotifierProvider<local.AuthProvider>.value(
        value: mockAuth,
        child: MaterialApp.router(
          routerConfig: buildAppRouter(mockAuth),
        ),
      ),
    );

    // Verify that our splash screen text is present.
    expect(find.text('Qlue AI'), findsOneWidget);
  });
}
