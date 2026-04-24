import 'package:flutter_dotenv/flutter_dotenv.dart';

class ApiConstants {
  static String get baseUrl => dotenv.get('API_BASE_URL', fallback: 'https://api.qlue.ai');
  static String get websocketUrl => dotenv.get('WEBSOCKET_URL', fallback: 'wss://ws.qlue.ai');

  static const String login = '/auth/login';
  static const String register = '/auth/register';
  static const String googleLogin = '/auth/google';
  static const String authSync = '/auth/sync';
  static const String authProfile = '/auth/profile';
  static const String updateFcmToken = '/auth/fcm-token';
  
  static const String interviewInit = '/interview/init';
  static const String interviewTerminate = '/interview/terminate';
  
  static const String resumeValidateHash = '/resume/validate-hash';
  static const String resumeUploadUrl = '/resume/upload-url';
  static const String resumeList = '/resume/list';
  static const String resumeDetail = '/resume/detail';
  static const String resumeProcess = '/resume/process';
  static const String resumeSetActive = '/resume/active';
  static const String resumeDelete = '/resume/detail';  // DELETE with query param
  static const String resumeUpdate = '/resume/detail';  // PUT with query param
  
  static const String scraperFetch = '/scraper/fetch';
  static const String websiteValidate = '/website/validate';
  
  static const String feedbackReport = '/feedback/report';
  static const String sessionHistory = '/session/history';
}
