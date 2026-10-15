/// Compile-time environment configuration.
///
/// Values are injected at BUILD time via --dart-define-from-file:
///
///   flutter run   --dart-define-from-file=env.json
///   flutter build apk --release --dart-define-from-file=env.json
///
/// Copy env.example.json to env.json (gitignored) and fill in your values.
/// Unlike the previous envied setup, there is NO generated file and NO
/// build_runner step: the file is read fresh on every build, so editing
/// env.json and rebuilding is always enough for changes to take effect.
abstract class Env {
  static const String apiBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const String websocketUrl = String.fromEnvironment('WEBSOCKET_URL');
  static const String firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const String firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');
  static const String messagingSenderId = String.fromEnvironment('MESSAGING_SENDER_ID');
  static const String firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const String measurementId = String.fromEnvironment('MEASUREMENT_ID');
  static const String googleClientId = String.fromEnvironment('GOOGLE_CLIENT_ID');
  // The WEB OAuth client id. On Android/iOS this must be passed to
  // GoogleSignIn.initialize(serverClientId:) so Google mints the ID token that
  // Firebase signInWithCredential requires; without it idToken is null and
  // Google sign-in silently fails right after the account picker.
  static const String googleWebClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');

  /// Optional fallback address shown on the in-app Help & Support screen. The
  /// form now submits through the backend (POST /support) and stays in-app; this
  /// address is only surfaced as "you can also email us at …" text if a submit
  /// fails. Safe to leave empty.
  static const String supportEmail = String.fromEnvironment('SUPPORT_EMAIL');

  /// Fails fast with a clear message if the build was made without
  /// --dart-define-from-file (all values would silently be empty strings,
  /// producing confusing network/auth errors at runtime instead).
  static void validate() {
    if (apiBaseUrl.isEmpty || websocketUrl.isEmpty || firebaseApiKey.isEmpty) {
      throw StateError(
        'Environment not configured. Build/run the app with '
        '--dart-define-from-file=env.json (copy env.example.json first).',
      );
    }
  }
}
