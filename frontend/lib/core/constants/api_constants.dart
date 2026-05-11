import '../env.dart';

class ApiConstants {
  static String get baseUrl => Env.apiBaseUrl;
  static String get websocketUrl => Env.websocketUrl;

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
  
  static const String feedbackReport = '/dashboard/session'; // Returns both session and feedback data
  static const String sessionHistory = '/session/history';

  // External Service Endpoints
  static const String uiAvatarsBaseUrl = 'https://ui-avatars.com/api/';
  static const String dicebearBaseUrl = 'https://api.dicebear.com/7.x/avataaars/png';
}
