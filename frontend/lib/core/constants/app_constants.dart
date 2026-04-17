class AppConstants {
  static const Duration silenceTimeout = Duration(seconds: 10);
  static const int maxSilenceStrikes = 3;
  static const Duration websocketHeartbeatInterval = Duration(seconds: 30);
  static const Duration maxWebsocketReconnectDelay = Duration(seconds: 30);
  static const int maxResumeFileSize = 5242880; // 5 MB in bytes
  static const List<String> allowedResumeExtensions = ['pdf', 'doc', 'docx'];
}
