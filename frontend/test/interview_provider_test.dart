import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:dio/dio.dart';
import 'package:frontend/features/interview/providers/interview_provider.dart';
import 'package:frontend/shared/services/stt_service.dart';
import 'package:frontend/shared/services/tts_service.dart';
import 'package:frontend/core/network/websocket_client.dart';

class MockSttService extends Mock implements SttService {}
class MockTtsService extends Mock implements TtsService {}
class MockDio extends Mock implements Dio {}
class MockFirebaseAuth extends Mock implements FirebaseAuth {}
class MockUser extends Mock implements User {}
class MockWebSocketClient extends Mock implements WebSocketClient {}
class MockResponse extends Mock implements Response {}

void main() {
  late MockSttService mockStt;
  late MockTtsService mockTts;
  late MockDio mockDio;
  late MockFirebaseAuth mockAuth;
  late MockUser mockUser;
  late MockWebSocketClient mockWs;

  setUp(() {
    mockStt = MockSttService();
    mockTts = MockTtsService();
    mockDio = MockDio();
    mockAuth = MockFirebaseAuth();
    mockUser = MockUser();
    mockWs = MockWebSocketClient();

    when(() => mockAuth.currentUser).thenReturn(mockUser);
    when(() => mockUser.uid).thenReturn('user123');
    when(() => mockUser.getIdToken()).thenAnswer((_) async => 'token123');
    
    when(() => mockStt.init()).thenAnswer((_) async => true);
    when(() => mockWs.messages).thenAnswer((_) => const Stream.empty());
    when(() => mockWs.errors).thenAnswer((_) => const Stream.empty());
    when(() => mockWs.disconnects).thenAnswer((_) => const Stream.empty());
    when(() => mockWs.reconnects).thenAnswer((_) => const Stream.empty());
  });

  group('InterviewProvider Tests', () {
    test('initSession should setup session and connect websocket', () async {
      final provider = InterviewProvider(
        sttService: mockStt,
        ttsService: mockTts,
        dio: mockDio,
        auth: mockAuth,
        wsClientFactory: (url, userId, sessionId) => mockWs,
      );

      final mockResponse = MockResponse();
      when(() => mockResponse.data).thenReturn({'sessionId': 'session123'});
      when(() => mockDio.post(any(), data: any(named: 'data')))
          .thenAnswer((_) async => mockResponse);

      when(() => mockWs.connect(authToken: any(named: 'authToken')))
          .thenAnswer((_) async => {});
      when(() => mockWs.waitForConnection()).thenAnswer((_) async => {});
      when(() => mockWs.sendMessage(any())).thenReturn(null);

      await provider.initSession('RESUME');

      expect(provider.sessionId, 'session123');
      expect(provider.isConnecting, false);
      verify(() => mockWs.connect(authToken: 'token123')).called(1);
      verify(() => mockWs.sendMessage(any(that: predicate((m) => (m as Map)['type'] == 'session_init')))).called(1);
    });

    test('endSession should terminate and cleanup', () async {
      final provider = InterviewProvider(
        sttService: mockStt,
        ttsService: mockTts,
        dio: mockDio,
        auth: mockAuth,
        wsClientFactory: (url, userId, sessionId) => mockWs,
      );

      provider.sessionId = 'session123';
      // Mocking the internal wsClient
      // This is a bit tricky since it's private, but we can call initSession first
      // Or we can just set it via the factory if we call a method that uses it.
      
      when(() => mockWs.sendMessage(any())).thenReturn(null);
      when(() => mockWs.disconnect()).thenReturn(null);
      when(() => mockStt.stop()).thenAnswer((_) async => {});
      when(() => mockTts.stop()).thenAnswer((_) async => {});
      
      // We need to trigger initSession to set _wsClient
      final mockResponse = MockResponse();
      when(() => mockResponse.data).thenReturn({'sessionId': 'session123'});
      when(() => mockDio.post(any(), data: any(named: 'data')))
          .thenAnswer((_) async => mockResponse);
      when(() => mockWs.connect(authToken: any(named: 'authToken'))).thenAnswer((_) async => {});
      when(() => mockWs.waitForConnection()).thenAnswer((_) async => {});
      
      await provider.initSession('RESUME');
      await provider.endSession();

      expect(provider.isSessionEnded, true);
      verify(() => mockWs.sendMessage(any(that: predicate((m) => (m as Map)['type'] == 'terminate_session')))).called(1);
      verify(() => mockWs.disconnect()).called(1);
    });
  });
}
