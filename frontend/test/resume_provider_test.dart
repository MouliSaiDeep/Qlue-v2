import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/context/resume_provider.dart';

void main() {
  group('ResumeProvider Tests', () {
    test('initial state should be empty and not loading', () {
      final provider = ResumeProvider();
      expect(provider.resumes.isEmpty, true);
      expect(provider.isLoading, false);
      expect(provider.activeResume, null);
    });

    test('maxAllowed should defaults to 5', () {
      final provider = ResumeProvider();
      expect(provider.maxAllowed, 5);
    });
  });
}
