import 'package:dio/dio.dart';
import '../network/dio_client.dart';
import '../constants/api_constants.dart';
import '../models/resume_model.dart';

class ResumeApiService {
  final Dio _dio = DioClient().dio;

  Future<Map<String, dynamic>> generatePresignedUrl({
    required String fileName,
    required int fileSize,
    required String fileHash,
  }) async {
    final response = await _dio.post(
      ApiConstants.resumeUploadUrl,
      data: {
        'fileName': fileName,
        'fileSize': fileSize,
        'fileHash': fileHash,
      },
    );
    return response.data['data'];
  }

  Future<Map<String, dynamic>> getResumeList() async {
    final response = await _dio.get(ApiConstants.resumeList);
    final data = response.data['data'];
    return {
      'resumes': (data['resumes'] as List).map((e) => ResumeModel.fromJson(e as Map<String, dynamic>)).toList(),
      'maxAllowed': data['maxAllowed'],
    };
  }

  Future<ResumeModel> getResumeDetail(String resumeId) async {
    final response = await _dio.get(
      ApiConstants.resumeDetail,
      queryParameters: {'resumeId': resumeId},
    );
    return ResumeModel.fromJson(response.data['data']['resume']);
  }

  Future<void> deleteResume(String resumeId) async {
    await _dio.delete(
      ApiConstants.resumeDelete,
      queryParameters: {'resumeId': resumeId},
    );
  }

  Future<void> setActiveResume(String resumeId) async {
    await _dio.put(
      ApiConstants.resumeSetActive,
      data: {'resumeId': resumeId},
    );
  }

  Future<Map<String, dynamic>> validateResumeHash(String fileHash) async {
    final response = await _dio.post(
      ApiConstants.resumeValidateHash,
      data: {'fileHash': fileHash},
    );
    return response.data['data'];
  }

  Future<ResumeModel> updateResumeParsedData(String resumeId, Map<String, dynamic> updates) async {
    final response = await _dio.put(
      ApiConstants.resumeUpdate,
      queryParameters: {'resumeId': resumeId},
      data: {'updates': updates},
    );
    return ResumeModel.fromJson(response.data['data']['resume']);
  }

  Future<Map<String, dynamic>> processResumeUpload(String resumeId) async {
    final response = await _dio.post(
      ApiConstants.resumeProcess,
      data: {'resumeId': resumeId},
    );
    return response.data['data'];
  }
}
