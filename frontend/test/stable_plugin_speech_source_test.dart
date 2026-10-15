import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:frontend/shared/services/platform_speech_source.dart';

class MockSpeech extends Mock implements SpeechToText {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() => registerFallbackValue(SpeechListenOptions()));
  for (final locale in ['en_GB', 'hi_IN']) {
    test(
      'hosted stable plugin locale $locale, timing, results and cancellation ownership',
      () async {
        final speech = MockSpeech();
        when(
          () => speech.initialize(
            onError: any(named: 'onError'),
            onStatus: any(named: 'onStatus'),
          ),
        ).thenAnswer((_) async => true);
        when(
          () => speech.systemLocale(),
        ).thenAnswer((_) async => LocaleName(locale, locale));
        var failCancel = false;
        when(() => speech.cancel()).thenAnswer((_) async {
          if (failCancel) {
            failCancel = false;
            throw StateError('cancel failed');
          }
        });
        final callbacks = <Function(SpeechRecognitionResult)>[];
        SpeechListenOptions? options;
        when(
          () => speech.listen(
            onResult: any(named: 'onResult'),
            listenOptions: any(named: 'listenOptions'),
          ),
        ).thenAnswer((call) async {
          options = call.namedArguments[#listenOptions] as SpeechListenOptions;
          callbacks.add(
            call.namedArguments[#onResult] as Function(SpeechRecognitionResult),
          );
        });
        final source = AndroidSpeechSource(speech: speech),
            frames = <Map<String, dynamic>>[];
        expect(await source.initialize(), true);
        final subscription = source.events.listen(frames.add);
        await source.start(42);
        expect(options!.listenFor, const Duration(seconds: 120));
        expect(options!.pauseFor, const Duration(seconds: 30));
        expect(options!.localeId, locale == 'en_GB' ? 'en_GB' : 'en_IN');
        expect(options!.partialResults, true);
        expect(options!.listenMode, ListenMode.dictation);
        SpeechRecognitionResult result(String text, bool finalResult) =>
            SpeechRecognitionResult(
              [SpeechRecognitionWords(text, null, 1)],
              finalResult
                  ? ResultType.finalResult.value
                  : ResultType.partial.value,
            );
        callbacks[0](result('plugin partial', false));
        callbacks[0](result('plugin final including fallback', true));
        expect(frames.map((e) => e['type']), ['partial', 'final']);
        expect(frames.last['text'], 'plugin final including fallback');
        await source.cancel(41);
        verifyNever(() => speech.cancel());
        failCancel = true;
        await expectLater(source.cancel(42), throwsStateError);
        await source.cancel(42);
        verify(() => speech.cancel()).called(2);
        callbacks[0](result('cancelled', true));
        expect(frames, hasLength(2));
        await source.start(43);
        callbacks[0](result('old question', true));
        expect(frames, hasLength(2));
        callbacks[1](result('new question', true));
        expect(frames.last['epoch'], 43);
        await source.cancel(43);
        await subscription.cancel();
      },
    );
  }
}
