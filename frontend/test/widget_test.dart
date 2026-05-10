import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/app.dart';
import 'package:frontend/context/auth_provider.dart';
import 'package:provider/provider.dart';

void main() {
  testWidgets('App smoke test - shows splash screen', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AuthProvider(),
        child: Consumer<AuthProvider>(
          builder: (context, auth, _) {
            return MaterialApp.router(
              routerConfig: buildAppRouter(auth),
            );
          },
        ),
      ),
    );

    // Verify that our splash screen text is present.
    expect(find.text('Qlue AI'), findsOneWidget);
  });
}
