import 'package:flutter/material.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';
import 'app.dart';
import 'context/auth_provider.dart';
import 'features/interview/providers/interview_provider.dart';
import 'context/resume_provider.dart';
import 'core/theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  await dotenv.load(fileName: ".env");
  await Firebase.initializeApp(
    options: FirebaseOptions(
      apiKey: dotenv.get('FIREBASE_API_KEY', fallback: 'AIzaSyAz83QyHgC5rv-8Zx2LOssyUBY7cmz3sYI'),
      appId: dotenv.get('FIREBASE_APP_ID', fallback: '1:425417594832:web:c9ea5413c99113eb844bd5'),
      messagingSenderId: dotenv.get('MESSAGING_SENDER_ID', fallback: '425417594832'),
      projectId: dotenv.get('FIREBASE_PROJECT_ID', fallback: 'qlue-backend-2c0c7'),
      storageBucket: '${dotenv.get('FIREBASE_PROJECT_ID', fallback: 'qlue-backend-2c0c7')}.firebasestorage.app',
      measurementId: dotenv.get('MEASUREMENT_ID', fallback: 'G-FYGDSCV1C7'),
    ),
  );
  await GoogleSignIn.instance.initialize(
    clientId: dotenv.get('GOOGLE_WEB_CLIENT_ID', fallback: '425417594832-ka8njkac1kd9h7sut8ojjmqg3jed5l7t.apps.googleusercontent.com'),
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
        ChangeNotifierProvider(create: (_) => ThemeNotifier()),
      ],
      child: Consumer2<AuthProvider, ThemeNotifier>(
        builder: (context, auth, themeNotifier, _) {
          return AppThemeColorsProvider(
            colors: themeNotifier.colors,
            child: MaterialApp.router(
              title: 'Qlue AI',
              debugShowCheckedModeBanner: false,
              theme: AppTheme.darkTheme,
              themeMode: themeNotifier.themeMode,
              routerConfig: buildAppRouter(auth),
            ),
          );
        },
      ),
    );
  }
}
