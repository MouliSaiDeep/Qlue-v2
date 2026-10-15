import 'package:flutter_test/flutter_test.dart';
import 'helpers/pcm_endpoint.dart';

void main() {
  test(
    'four seconds of non-speech ends once, shorter pauses reset on speech',
    () {
      final clock = AudioEndpoint();
      expect(clock.accept(speech: true, samples: 512), isNull);
      for (final seconds in [1, 2, 3]) {
        expect(clock.accept(speech: false, samples: 16000 * seconds), isNull);
        expect(clock.accept(speech: true, samples: 512), isNull);
      }
      expect(clock.accept(speech: false, samples: 63999), isNull);
      expect(clock.accept(speech: false, samples: 1), 'speechEnd');
      expect(clock.accept(speech: false, samples: 64000), isNull);
    },
  );

  test('initial thinking is fifteen seconds, and downtime adds no silence', () {
    final clock = AudioEndpoint();
    expect(clock.accept(speech: false, samples: 239999), isNull);
    clock.resume();
    expect(clock.accept(speech: false, samples: 239999), isNull);
    expect(clock.accept(speech: false, samples: 1), 'noAnswer');
    final resumed = AudioEndpoint();
    resumed.accept(speech: true, samples: 512);
    resumed.accept(speech: false, samples: 32000);
    resumed.resume();
    expect(resumed.heardSpeech, isTrue);
    expect(resumed.accept(speech: false, samples: 63999), isNull);
    expect(resumed.accept(speech: false, samples: 1), 'speechEnd');
  });
}
