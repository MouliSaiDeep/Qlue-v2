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
            // Passing false uses the cached token unless it's close to expiring
            final token = await user.getIdToken(false);
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) async {
          // ADD THESE PRINT STATEMENTS
          print("🚨 API ERROR: ${e.response?.statusCode} on ${e.requestOptions.path}");
          print("🚨 API RESPONSE: ${e.response?.data}");

          if (e.response?.statusCode == 401 || e.response?.statusCode == 403) {
            print("🔄 Attempting to refresh Firebase Token...");
            final user = FirebaseAuth.instance.currentUser;
            
            if (user != null && e.requestOptions.headers['_retry'] != true) {
              e.requestOptions.headers['_retry'] = true;
              try {
                final token = await user.getIdToken(true);
                print("✅ Token refreshed successfully! Retrying request...");
                
                e.requestOptions.headers['Authorization'] = 'Bearer $token';
                final retryDio = Dio(BaseOptions(baseUrl: ApiConstants.baseUrl));
                final response = await retryDio.fetch(e.requestOptions);
                
                return handler.resolve(response);
              } catch (retryError) {
                print("❌ Token refresh or retry failed: $retryError");
                return handler.next(e);
              }
            } else {
               print("❌ User is null or retry flag already set.");
            }
          }
          return handler.next(e);
        },
      ),
    );
  }
}
