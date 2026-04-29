import 'dart:async';
import 'dart:convert';
import 'package:just_audio/just_audio.dart';
import 'package:flutter/foundation.dart';

class TtsService {
  static final TtsService _instance = TtsService._internal();
  factory TtsService() => _instance;
  TtsService._internal();

  final AudioPlayer _player = AudioPlayer();
  StreamController<List<int>>? _audioStreamController;
  bool _isPlaying = false;
  bool _lastChunkReceived = false;
  Function? onPlaybackComplete;
  
  int _nextExpectedChunkIndex = 0;
  final Map<int, List<int>> _outOfOrderBuffer = {};

  bool get isPlaying => _isPlaying;

  Future<void> playBase64Chunk(String base64Data, bool isLast, {int? chunkIndex}) async {
    if (isLast) {
      _lastChunkReceived = true;
      if (_audioStreamController != null && !_audioStreamController!.isClosed) {
        _audioStreamController!.close();
      }
      _outOfOrderBuffer.clear();
      _nextExpectedChunkIndex = 0;
    }

    if (base64Data.isNotEmpty) {
      try {
        final bytes = base64Decode(base64Data);
        
        if (chunkIndex == null) {
          _addBytesToStream(bytes);
        } else if (chunkIndex == _nextExpectedChunkIndex) {
          _addBytesToStream(bytes);
          _nextExpectedChunkIndex++;
          
          while (_outOfOrderBuffer.containsKey(_nextExpectedChunkIndex)) {
            final bufferedBytes = _outOfOrderBuffer.remove(_nextExpectedChunkIndex)!;
            _addBytesToStream(bufferedBytes);
            _nextExpectedChunkIndex++;
          }
        } else if (chunkIndex > _nextExpectedChunkIndex) {
          _outOfOrderBuffer[chunkIndex] = bytes;
        }
      } catch (e) {
        debugPrint('TTS Decode Error: $e');
      }
    }

    if (isLast && (_audioStreamController == null || _audioStreamController!.isClosed)) {
      _isPlaying = false;
      onPlaybackComplete?.call();
    }
  }

  void _addBytesToStream(List<int> bytes) {
    if (_audioStreamController == null || _audioStreamController!.isClosed) {
      _audioStreamController = StreamController<List<int>>();
      _startPlayback();
    }
    _audioStreamController!.add(bytes);
  }

  Future<void> _startPlayback() async {
    if (_isPlaying || _audioStreamController == null) return;
    _isPlaying = true;

    try {
      final source = ByteStreamAudioSource(_audioStreamController!.stream);
      await _player.setAudioSource(source);
      await _player.play();
      
      await _player.processingStateStream
          .firstWhere((state) => state == ProcessingState.completed)
          .timeout(const Duration(seconds: 60), onTimeout: () => ProcessingState.completed);
          
    } catch (e) {
      debugPrint('TTS Playback Error: $e');
    } finally {
      _isPlaying = false;
      if (_lastChunkReceived) {
        _lastChunkReceived = false;
        await Future.delayed(const Duration(milliseconds: 500));
        debugPrint('TTS: Buffer drained — firing onPlaybackComplete');
        onPlaybackComplete?.call();
      }
    }
  }

  Future<void> stop() async {
    await _player.stop();
    if (_audioStreamController != null && !_audioStreamController!.isClosed) {
      _audioStreamController!.close();
    }
    _audioStreamController = null;
    _isPlaying = false;
    _lastChunkReceived = false;
    _outOfOrderBuffer.clear();
    _nextExpectedChunkIndex = 0;
  }

  void dispose() {
    _player.dispose();
  }
}

class ByteStreamAudioSource extends StreamAudioSource {
  final Stream<List<int>> byteStream;
  ByteStreamAudioSource(this.byteStream);

  @override
  Future<StreamAudioResponse> request([int? start, int? end]) async {
    return StreamAudioResponse(
      sourceLength: null,
      contentLength: null,
      offset: start ?? 0,
      stream: byteStream,
      contentType: 'audio/mpeg',
    );
  }
}
