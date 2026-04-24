import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';

class TtsService {
  static final TtsService _instance = TtsService._internal();
  factory TtsService() => _instance;
  TtsService._internal();

  final AudioPlayer _player = AudioPlayer();
  final List<Uint8List> _queue = [];
  bool _isPlaying = false;
  
  Function? onPlaybackComplete;

  Future<void> playBase64Chunk(String base64Data, bool isLast) async {
    if (base64Data.isNotEmpty) {
      final bytes = base64Decode(base64Data);
      _queue.add(bytes);
    }

    if (!_isPlaying && _queue.isNotEmpty) {
      _startPlayback();
    }

    if (isLast && _queue.isEmpty && !_isPlaying) {
      onPlaybackComplete?.call();
    }
  }

  Future<void> _startPlayback() async {
    if (_queue.isEmpty || _isPlaying) return;
    
    _isPlaying = true;
    
    while (_queue.isNotEmpty) {
      final chunk = _queue.removeAt(0);
      try {
        await _player.play(BytesSource(chunk));
        // We need to wait for the player to finish this specific chunk
        // Audioplayers 6.x doesn't have a simple way to wait for "play" to finish for a ByteSource 
        // if we are streaming, but we can use the onPlayerComplete stream.
        await _player.onPlayerComplete.first;
      } catch (e) {
        print('Error playing audio chunk: $e');
      }
    }
    
    _isPlaying = false;
    onPlaybackComplete?.call();
  }

  Future<void> stop() async {
    await _player.stop();
    _queue.clear();
    _isPlaying = false;
  }

  void dispose() {
    _player.dispose();
  }
}
