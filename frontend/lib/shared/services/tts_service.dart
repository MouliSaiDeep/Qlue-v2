import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

class TtsService {
  final AudioPlayer _player = AudioPlayer();
  Completer<void>? _playbackCompleter;

  Future<void> playUrl(String url) async {
    await stop();
    _playbackCompleter = Completer<void>();

    try {
      await _player.setAudioSource(AudioSource.uri(Uri.parse(url)));
      await _player.play();

      // Handle web platform where completed state may not fire
      final duration = _player.duration;
      if (duration != null) {
        await Future.any([
          _player.processingStateStream
              .firstWhere((state) => 
                  state == ProcessingState.completed || state == ProcessingState.idle)
              .timeout(const Duration(seconds: 30), onTimeout: () => ProcessingState.idle),
          Future.delayed(duration + const Duration(milliseconds: 500)),
        ]);
      } else {
        await _player.processingStateStream
            .firstWhere((state) => 
                state == ProcessingState.completed || state == ProcessingState.idle)
            .timeout(const Duration(seconds: 30), onTimeout: () => ProcessingState.idle);
      }

      if (!_playbackCompleter!.isCompleted) {
        _playbackCompleter!.complete();
      }
    } catch (e) {
      if (!_playbackCompleter!.isCompleted) {
        _playbackCompleter!.completeError(e);
      }
    }
  }

  Future<void> playBase64(String base64Data) async {
    await stop();
    _playbackCompleter = Completer<void>();
    try {
      final bytes = base64Decode(base64Data);
      final tempDir = await getTemporaryDirectory();
      final file = File('${tempDir.path}/temp_audio.mp3');
      await file.writeAsBytes(bytes);
      await _player.setAudioSource(AudioSource.uri(file.uri));
      await _player.play();

      // FE-BUG #10 FIX: Match playUrl's timeout + idle fallback to prevent infinite hang
      final duration = _player.duration;
      if (duration != null) {
        await Future.any([
          _player.processingStateStream
              .firstWhere((s) =>
                  s == ProcessingState.completed || s == ProcessingState.idle)
              .timeout(const Duration(seconds: 30), onTimeout: () => ProcessingState.idle),
          Future.delayed(duration + const Duration(milliseconds: 500)),
        ]);
      } else {
        await _player.processingStateStream
            .firstWhere((s) =>
                s == ProcessingState.completed || s == ProcessingState.idle)
            .timeout(const Duration(seconds: 30), onTimeout: () => ProcessingState.idle);
      }

      // FE-BUG #11 FIX: Guard complete() to prevent double-complete crash
      if (!_playbackCompleter!.isCompleted) {
        _playbackCompleter!.complete();
      }
    } catch (e) {
      if (!_playbackCompleter!.isCompleted) {
        _playbackCompleter!.completeError(e);
      }
    }
  }

  Future<void> stop() async {
    await _player.stop();
    // FE-BUG #11 FIX: Guard complete() to prevent double-complete crash
    if (_playbackCompleter != null && !_playbackCompleter!.isCompleted) {
      _playbackCompleter!.complete();
    }
  }

  Future<void> waitForCompletion() async {
    await _playbackCompleter?.future;
  }

  void dispose() {
    _player.dispose();
  }
}
