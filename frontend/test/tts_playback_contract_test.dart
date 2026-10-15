import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:frontend/shared/services/tts_service.dart';

class PlayerBoundary implements PlaybackPort {
  Completer<void>? loading;
  Completer<void> playing = Completer<void>();
  int starts = 0;
  int stops = 0;
  Object? loadError;
  @override
  Future<void> load(AudioSource source) async {
    if (loadError != null) throw loadError!;
    await loading?.future;
  }
  @override
  Future<void> play() { starts++; return playing.future; }
  @override
  Future<void> stop() async { stops++; }
  @override
  Future<void> dispose() async {}
}

void main() {
  test('URL failure propagates through the playback future and stops audio', () async {
    final port = PlayerBoundary()..loadError = StateError('URL unavailable');
    final service = TtsService(playback: port);
    await expectLater(service.playUrl('https://example.com/audio.mp3'), throwsStateError);
    expect(port.starts, 0);
    expect(port.stops, 2);
  });
  test('stop waits for pending native load and obsolete playback cannot start', () async {
    final port = PlayerBoundary()..loading = Completer<void>();
    final service = TtsService(playback: port);
    final old = service.playUrl('https://example.com/old.mp3');
    await Future<void>.delayed(Duration.zero);
    var stopped = false;
    final stop = service.stop().then((_) => stopped = true);
    await Future<void>.delayed(Duration.zero);
    expect(stopped, false);
    port.loading!.complete();
    await stop;
    await old;
    expect(port.starts, 0);
    expect(stopped, true);
  });
  test('late completion of canceled playback does not finish newer playback', () async {
    final port = PlayerBoundary();
    final service = TtsService(playback: port);
    final old = service.playUrl('https://example.com/old.mp3');
    await Future<void>.delayed(Duration.zero);
    final oldPlaying = port.playing;
    await service.stop();
    await old;
    port.playing = Completer<void>();
    var newFinished = false;
    final newer = service.playUrl('https://example.com/new.mp3').then((_) => newFinished = true);
    await Future<void>.delayed(Duration.zero);
    oldPlaying.complete();
    await Future<void>.delayed(Duration.zero);
    expect(newFinished, false);
    port.playing.complete();
    await newer;
    expect(newFinished, true);
  });
}
