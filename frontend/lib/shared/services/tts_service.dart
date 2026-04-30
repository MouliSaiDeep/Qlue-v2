import 'dart:async';
import 'dart:convert';
import 'package:just_audio/just_audio.dart';
import 'package:flutter/foundation.dart';

class TtsService {
  static final TtsService _instance = TtsService._internal();
  factory TtsService() => _instance;
  TtsService._internal();

  final AudioPlayer _player = AudioPlayer();
  bool _isPlaying = false;
  Function? onPlaybackComplete;

  bool get isPlaying => _isPlaying;

  Future<void> playBase64(String base64Data) async {
    await stop();
    final bytes = base64Decode(base64Data);
    await _playBytes(bytes);
  }

  Future<void> playUrl(String url) async {
    await stop();
    _isPlaying = true;

    try {
      await _player.setAudioSource(AudioSource.uri(Uri.parse(url)));
      await _player.play();
      await _player.processingStateStream
          .firstWhere((state) => state == ProcessingState.completed)
          .timeout(const Duration(seconds: 60), onTimeout: () => ProcessingState.completed);
    } catch (e) {
      debugPrint('TTS Playback Error: $e');
    } finally {
      _isPlaying = false;
      onPlaybackComplete?.call();
    }
  }

  Future<void> _playBytes(Uint8List bytes) async {
    final dataUri = Uri.dataFromBytes(bytes, mimeType: 'audio/mpeg').toString();
    final source = AudioSource.uri(Uri.parse(dataUri));

    try {
      await _player.setAudioSource(source);
      _isPlaying = true;
      await _player.play();
      await _player.processingStateStream
          .firstWhere((state) => state == ProcessingState.completed)
          .timeout(const Duration(seconds: 60), onTimeout: () => ProcessingState.completed);
    } catch (e) {
      debugPrint('TTS Playback Error: $e');
    } finally {
      _isPlaying = false;
      onPlaybackComplete?.call();
    }
  }

  Future<void> stop() async {
    try {
      await _player.stop();
    } catch (e) {
      debugPrint('TTS stop error: $e');
    }
    _isPlaying = false;
  }

  void dispose() {
    _player.dispose();
  }
}
