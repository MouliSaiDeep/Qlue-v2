import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';
import 'app.dart';
import 'context/auth_provider.dart';
import 'features/interview/providers/interview_provider.dart';
import 'context/resume_provider.dart';
import 'context/dashboard_provider.dart';
import 'core/theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  await dotenv.load(fileName: ".env");
  await Firebase.initializeApp(
    options: FirebaseOptions(
      apiKey: dotenv.env['FIREBASE_API_KEY'] ?? '',
      appId: dotenv.env['FIREBASE_APP_ID'] ?? '',
      messagingSenderId: dotenv.env['MESSAGING_SENDER_ID'] ?? '',
      projectId: dotenv.env['FIREBASE_PROJECT_ID'] ?? '',
      measurementId: dotenv.env['MEASUREMENT_ID'],
    ),
  );
  await GoogleSignIn.instance.initialize(
    clientId: kIsWeb ? '425417594832-ka8njkac1kd9h7sut8ojjmqg3jed5l7t.apps.googleusercontent.com' : null,
  );
  
  runApp(const QlueApp());
}

class QlueApp extends StatelessWidget {
  const QlueApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => InterviewProvider()),
        ChangeNotifierProvider(create: (_) => ResumeProvider()),
        ChangeNotifierProvider(create: (_) => DashboardProvider()),
        ChangeNotifierProvider(create: (_) => ThemeNotifier()),
      ],
      child: const RouterWrapper(),
    );
  }
}

class RouterWrapper extends StatefulWidget {
  const RouterWrapper({super.key});

  @override
  State<RouterWrapper> createState() => _RouterWrapperState();
}

class _RouterWrapperState extends State<RouterWrapper> {
  late GoRouter _router;

  @override
  void initState() {
    super.initState();
    // Build the router once and let GoRouter handle updates via refreshListenable
    _router = buildAppRouter(context.read<AuthProvider>());
  }

  @override
  Widget build(BuildContext context) {
    final themeNotifier = Provider.of<ThemeNotifier>(context);
    return AppThemeColorsProvider(
      colors: themeNotifier.colors,
      child: MaterialApp.router(
        title: 'Qlue AI',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.darkTheme,
        themeMode: themeNotifier.themeMode,
        routerConfig: _router,
      ),
    );
  }
}
