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
  Timer? _jitterTimer;
  int? _finalChunkIndex;

  bool get isPlaying => _isPlaying;

  Future<void> playBase64Chunk(String base64Data, bool isLast, {int? chunkIndex}) async {
    if (isLast) {
      _lastChunkReceived = true;
      if (chunkIndex != null) {
        _finalChunkIndex = chunkIndex;
      }
    }

    if (base64Data.isNotEmpty && chunkIndex != null) {
      try {
        final bytes = base64Decode(base64Data);
        
        if (chunkIndex == _nextExpectedChunkIndex) {
          _addBytesToStream(bytes);
          _nextExpectedChunkIndex++;
          
          while (_outOfOrderBuffer.containsKey(_nextExpectedChunkIndex)) {
            final bufferedBytes = _outOfOrderBuffer.remove(_nextExpectedChunkIndex)!;
            _addBytesToStream(bufferedBytes);
            _nextExpectedChunkIndex++;
          }
          
          _resetJitterTimer();
        } else if (chunkIndex > _nextExpectedChunkIndex) {
          _outOfOrderBuffer[chunkIndex] = bytes;
          _startJitterTimer();
        }
      } catch (e) {
        debugPrint('TTS Decode Error: $e');
      }
    }

    // Check if we reached the end
    if (_lastChunkReceived && _finalChunkIndex != null && _nextExpectedChunkIndex >= _finalChunkIndex!) {
      if (_audioStreamController != null && !_audioStreamController!.isClosed) {
        _audioStreamController!.close();
      }
      _cleanupBuffer();
    }

    if (isLast && base64Data.isEmpty && (_audioStreamController == null || _audioStreamController!.isClosed)) {
      _isPlaying = false;
      onPlaybackComplete?.call();
    }
  }

  void _startJitterTimer() {
    _jitterTimer?.cancel();
    _jitterTimer = Timer(const Duration(milliseconds: 500), () {
      debugPrint('TTS Jitter Timeout: Skipping chunk $_nextExpectedChunkIndex');
      _nextExpectedChunkIndex++;
      
      while (_outOfOrderBuffer.containsKey(_nextExpectedChunkIndex)) {
        final bufferedBytes = _outOfOrderBuffer.remove(_nextExpectedChunkIndex)!;
        _addBytesToStream(bufferedBytes);
        _nextExpectedChunkIndex++;
      }
      
      if (_lastChunkReceived && _finalChunkIndex != null && _nextExpectedChunkIndex >= _finalChunkIndex!) {
        _audioStreamController?.close();
        _cleanupBuffer();
      }
    });
  }

  void _resetJitterTimer() {
    _jitterTimer?.cancel();
    _jitterTimer = null;
  }

  void _cleanupBuffer() {
    _outOfOrderBuffer.clear();
    _nextExpectedChunkIndex = 0;
    _finalChunkIndex = null;
    _jitterTimer?.cancel();
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
