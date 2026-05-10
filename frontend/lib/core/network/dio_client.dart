import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../constants/api_constants.dart';

class DioClient {
  static final DioClient _instance = DioClient._internal();
  late final Dio _dio;

  factory DioClient() => _instance;

  Dio get dio => _dio;

  DioClient._internal() {
    _dio = Dio(
      BaseOptions(
        baseUrl: ApiConstants.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 60),
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          User? user = FirebaseAuth.instance.currentUser;

          // Wait briefly if Firebase is still initializing during a Hot Restart
          if (user == null) {
            await Future.delayed(const Duration(milliseconds: 100));
            user = FirebaseAuth.instance.currentUser;
          }

          if (user != null) {
            final token = await user.getIdToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) async {
          // Debug logging for easier troubleshooting
          print("🚨 API ERROR: ${e.response?.statusCode} on ${e.requestOptions.path}");
          print("🚨 API RESPONSE: ${e.response?.data}");

          if (e.response?.statusCode == 401 || e.response?.statusCode == 403) {
            print("🔄 Attempting to refresh Firebase Token...");
            final user = FirebaseAuth.instance.currentUser;
            
            // Check if we already tried to refresh for this specific request
            final int retryCount = e.requestOptions.headers['_retryCount'] ?? 0;
            
            if (user != null && retryCount < 2) {
              e.requestOptions.headers['_retryCount'] = retryCount + 1;
              try {
                // Force refresh the token
                final token = await user.getIdToken(true);
                if (token != null && token.isNotEmpty) {
                  print("✅ Token refreshed successfully! Retrying request...");
                  e.requestOptions.headers['Authorization'] = 'Bearer $token';
                  
                  // Retry the request using a temporary Dio to avoid infinite interceptor loops
                  final retryDio = Dio(BaseOptions(baseUrl: ApiConstants.baseUrl));
                  final response = await retryDio.fetch(e.requestOptions);
                  return handler.resolve(response);
                }
              } catch (retryError) {
                print("❌ Token refresh or retry failed: $retryError");
                // If refresh fails, just pass the original error
                return handler.next(e);
              }
            } else {
               print("❌ User is null or retry limit exceeded.");
            }
          }
          return handler.next(e);
        },
      ),
    );
  }
}
