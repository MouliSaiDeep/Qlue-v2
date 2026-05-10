import 'package:flutter_test/flutter_test.dart';
import 'package:frontend/core/constants/api_constants.dart';

void main() {
  test('ApiConstants should have correct dashboard session path', () {
    expect(ApiConstants.feedbackReport, '/dashboard/session');
  });

  test('ApiConstants should have correct interview init path', () {
    expect(ApiConstants.interviewInit, '/interview/init');
  });
}
