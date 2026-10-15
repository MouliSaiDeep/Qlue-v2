import 'package:flutter/services.dart';

class AudioEndpoint {
  static const sampleRate = 16000;
  static const frameSamples = 512;
  static const silenceSamples = sampleRate * 4;
  static const thinkingSamples = sampleRate * 15;
  int position = 0;
  int lastSpeech = 0;
  int origin = 0;
  bool heardSpeech = false;
  bool ended = false;

  String? accept({required bool speech, required int samples}) {
    if (ended) return null;
    position += samples;
    if (speech) {
      heardSpeech = true;
      lastSpeech = position;
      return null;
    }
    if (heardSpeech && position - lastSpeech >= silenceSamples) {
      ended = true;
      return 'speechEnd';
    }
    if (!heardSpeech && position - origin >= thinkingSamples) {
      ended = true;
      return 'noAnswer';
    }
    return null;
  }

  void resume() {
    origin = lastSpeech = position;
    ended = false;
  }
}

class PcmFrame {
  const PcmFrame({
    required this.pcm,
    required this.sequence,
    required this.firstFrame,
    required this.sampleTimeUs,
    required this.epoch,
    this.sampleRate = 16000,
    this.channels = 1,
  });
  final Uint8List pcm;
  final int sequence, firstFrame, sampleTimeUs, epoch, sampleRate, channels;
}

class PcmContinuity {
  int _sequence = 0, _nextFrame = 0;
  int? _originUs;
  void accept(PcmFrame frame, int epoch) {
    if (frame.epoch != epoch ||
        frame.sampleRate != 16000 ||
        frame.channels != 1 ||
        frame.pcm.length != 1024 ||
        frame.sequence != _sequence ||
        frame.firstFrame != _nextFrame) {
      throw StateError('Audio frames were missing or invalid');
    }
    _originUs ??= frame.sampleTimeUs;
    final expectedUs = _originUs! + frame.firstFrame * 1000000 ~/ 16000;
    // Timestamp uncertainty/gaps fail conservatively; they add no quiet time.
    if ((frame.sampleTimeUs - expectedUs).abs() > 20000) {
      throw StateError('Audio clock discontinuity');
    }
    _sequence++;
    _nextFrame += 512;
  }
}
