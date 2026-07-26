import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'core/env.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';
import 'app.dart';
import 'context/auth_provider.dart';
import 'features/interview/providers/interview_provider.dart';
import 'context/resume_provider.dart';
import 'context/dashboard_provider.dart';
import 'context/appearance_provider.dart';
import 'core/theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    // Fail fast if the build is missing --dart-define-from-file=env.json.
    Env.validate();

    // Disable runtime fetching to use local bundled fonts
    GoogleFonts.config.allowRuntimeFetching = false;

    await Firebase.initializeApp(
      options: FirebaseOptions(
        apiKey: Env.firebaseApiKey,
        appId: Env.firebaseAppId,
        messagingSenderId: Env.messagingSenderId,
        projectId: Env.firebaseProjectId,
        measurementId: Env.measurementId,
      ),
    );
    await GoogleSignIn.instance.initialize(
      clientId: kIsWeb ? Env.googleClientId : null,
    );

    runApp(const QlueApp());
  } catch (e, stack) {
    // Any failure above (bad env.json, Firebase misconfig, Google Sign-In
    // init) previously left runApp uncalled — i.e. a silent blank screen.
    // Show the actual error instead so the cause is visible on-device.
    debugPrint('FATAL: app initialization failed: $e\n$stack');
    runApp(_StartupErrorApp(error: e.toString()));
  }
}

/// Minimal fallback UI shown when startup initialization throws, so the app
/// surface is never blank. Deliberately depends on nothing but material.
class _StartupErrorApp extends StatelessWidget {
  final String error;
  const _StartupErrorApp({required this.error});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline,
                      color: Colors.redAccent, size: 48),
                  const SizedBox(height: 16),
                  const Text(
                    'Qlue failed to start',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    error,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
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
        ChangeNotifierProvider(create: (_) => AppearanceProvider()),
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
