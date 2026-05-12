import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:frontend/context/resume_provider.dart';

class MockResumeProvider extends Mock implements ResumeProvider {}

void main() {
  group('ResumeProvider Tests', () {
    test('initial state should be correct', () {
      final provider = ResumeProvider();
      expect(provider.isLoading, false);
      expect(provider.resumes, isEmpty);
    });

    test('uploadResume method should exist', () {
      final provider = ResumeProvider();
      expect(provider.uploadResume, isNotNull);
    });
  });
}
