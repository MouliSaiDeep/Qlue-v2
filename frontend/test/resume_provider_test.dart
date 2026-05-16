import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
<<<<<<< HEAD
import 'package:dio/dio.dart';
=======
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
import 'package:frontend/context/resume_provider.dart';
import 'package:frontend/core/services/resume_api_service.dart';
import 'package:frontend/core/models/resume_model.dart';

class MockResumeApiService extends Mock implements ResumeApiService {}
class MockDio extends Mock implements Dio {}
class MockResponse extends Mock implements Response {}

class MockResumeProvider extends Mock implements ResumeProvider {}

void main() {
  late MockResumeApiService mockApi;
  late MockDio mockS3Dio;

  setUpAll(() {
    registerFallbackValue(Uri());
    registerFallbackValue(Options());
  });

  setUp(() {
    mockApi = MockResumeApiService();
    mockS3Dio = MockDio();
  });

  group('ResumeProvider Tests', () {
<<<<<<< HEAD
    test('fetchResumes should update state on success', () async {
      final provider = ResumeProvider(apiService: mockApi);
      final mockResumes = [
        ResumeModel(
          resumeId: '1',
          fileName: 'test.pdf',
          fileSize: 1024,
          status: ResumeStatus.parsed,
          isActive: true,
          uploadedAt: DateTime.now().millisecondsSinceEpoch,
        )
      ];

      when(() => mockApi.getResumeList()).thenAnswer((_) async => {
        'resumes': mockResumes,
        'maxAllowed': 5,
      });

      await provider.fetchResumes();

      expect(provider.resumes.length, 1);
      expect(provider.activeResume?.resumeId, '1');
      expect(provider.isLoading, false);
    });

    test('uploadResume should follow full flow', () async {
      final provider = ResumeProvider(apiService: mockApi, s3Dio: mockS3Dio);
      final bytes = Uint8List.fromList([1, 2, 3]);

      when(() => mockApi.validateResumeHash(any())).thenAnswer((_) async => {'isDuplicate': false});
      when(() => mockApi.generatePresignedUrl(
        fileName: any(named: 'fileName'),
        fileSize: any(named: 'fileSize'),
        fileHash: any(named: 'fileHash'),
      )).thenAnswer((_) async => {
        'uploadUrl': 'https://s3.example.com/upload',
        'resumeId': 'new-id'
      });

      final mockResponse = MockResponse();
      when(() => mockResponse.statusCode).thenReturn(200);
      when(() => mockS3Dio.putUri(
        any(),
        data: any(named: 'data'),
        options: any(named: 'options'),
      )).thenAnswer((_) async => mockResponse);

      when(() => mockApi.processResumeUpload(any())).thenAnswer((_) async => {'success': true});
      when(() => mockApi.getResumeList()).thenAnswer((_) async => {'resumes': [], 'maxAllowed': 5});

      final result = await provider.uploadResume(bytes, 'test.pdf');

      expect(result, true);
      verify(() => mockApi.validateResumeHash(any())).called(1);
      verify(() => mockS3Dio.putUri(any(), data: bytes, options: any(named: 'options'))).called(1);
      verify(() => mockApi.processResumeUpload('new-id')).called(1);
    });

    test('setActiveResume should call api and refresh', () async {
      final provider = ResumeProvider(apiService: mockApi);
      
      when(() => mockApi.setActiveResume(any())).thenAnswer((_) async => {});
      when(() => mockApi.getResumeList()).thenAnswer((_) async => {'resumes': [], 'maxAllowed': 5});

      await provider.setActiveResume('res-123');

      verify(() => mockApi.setActiveResume('res-123')).called(1);
      verify(() => mockApi.getResumeList()).called(1);
=======
    test('initial state should be correct', () {
      final provider = ResumeProvider();
      expect(provider.isLoading, false);
      expect(provider.resumes, isEmpty);
    });

    test('uploadResume method should exist', () {
      final provider = ResumeProvider();
      expect(provider.uploadResume, isNotNull);
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66
    });
  });
}
