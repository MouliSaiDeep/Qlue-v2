import 'package:envied/envied.dart';

part 'env.g.dart';

@Envied(path: '.env', obfuscate: true)
abstract class Env {
  @EnviedField(varName: 'API_BASE_URL')
  static final String apiBaseUrl = _Env.apiBaseUrl;

  @EnviedField(varName: 'WEBSOCKET_URL')
  static final String websocketUrl = _Env.websocketUrl;

  @EnviedField(varName: 'FIREBASE_API_KEY')
  static final String firebaseApiKey = _Env.firebaseApiKey;

  @EnviedField(varName: 'FIREBASE_APP_ID')
  static final String firebaseAppId = _Env.firebaseAppId;

  @EnviedField(varName: 'MESSAGING_SENDER_ID')
  static final String messagingSenderId = _Env.messagingSenderId;

  @EnviedField(varName: 'FIREBASE_PROJECT_ID')
  static final String firebaseProjectId = _Env.firebaseProjectId;

  @EnviedField(varName: 'MEASUREMENT_ID')
  static final String measurementId = _Env.measurementId;

  @EnviedField(varName: 'GOOGLE_CLIENT_ID')
  static final String googleClientId = _Env.googleClientId;
}
