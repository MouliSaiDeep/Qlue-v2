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
          final user = FirebaseAuth.instance.currentUser;
          if (user != null) {
            final token = await user.getIdToken();
            options.headers['Authorization'] = 'Bearer $token';
          }
          return handler.next(options);
        },
        onError: (DioException e, handler) async {
          if (e.response?.statusCode == 401) {
            final user = FirebaseAuth.instance.currentUser;
            if (user != null && e.requestOptions.headers['_retry'] != true) {
              e.requestOptions.headers['_retry'] = true;
              try {
                // Force refresh the token
                final token = await user.getIdToken(true);
                e.requestOptions.headers['Authorization'] = 'Bearer $token';
                
                // Retry the request using a temporary Dio to avoid infinite interceptor loops
                final retryDio = Dio(BaseOptions(baseUrl: ApiConstants.baseUrl));
                final response = await retryDio.fetch(e.requestOptions);
                return handler.resolve(response);
              } catch (retryError) {
                return handler.next(e);
              }
            }
          }
          return handler.next(e);
        },
      ),
    );
  }
}
