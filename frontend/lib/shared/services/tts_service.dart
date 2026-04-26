import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

class TtsService {
  static final TtsService _instance = TtsService._internal();
  factory TtsService() => _instance;
  TtsService._internal();

  final AudioPlayer _player = AudioPlayer();
  final List<Uint8List> _queue = [];
  bool _isPlaying = false;
  bool _lastChunkReceived = false;

  bool get isPlaying => _isPlaying;
  List<Uint8List> get queue => List.unmodifiable(_queue);
  
  Function? onPlaybackComplete;

  Future<void> playBase64Chunk(String base64Data, bool isLast) async {
    if (isLast) {
      _lastChunkReceived = true;
    }

    if (base64Data.isNotEmpty) {
      try {
        final bytes = base64Decode(base64Data);
        _queue.add(bytes);
      } catch (e) {
        debugPrint('TTS Decode Error: $e');
      }
    }

    if (!_isPlaying && _queue.isNotEmpty) {
      _startPlayback();
    } else if (_lastChunkReceived && !_isPlaying && _queue.isEmpty) {
      // Edge case: All audio chunks already finished playing before the isLast
      // signal arrived (e.g., short response with fast playback).
      // Fire completion immediately since there's nothing left to play.
      debugPrint('TTS: isLast received after queue drained — firing completion immediately');
      _lastChunkReceived = false;
      onPlaybackComplete?.call();
    }
  }

  Future<void> _startPlayback() async {
    if (_queue.isEmpty || _isPlaying) return;
    
    _isPlaying = true;
    
    try {
      while (_queue.isNotEmpty) {
        final chunk = _queue.removeAt(0);
        try {
          await _player.setSource(BytesSource(chunk));
          await _player.resume();
          
          await _player.onPlayerComplete.first
              .timeout(const Duration(seconds: 30), onTimeout: () => null);
          
          await Future.delayed(const Duration(milliseconds: 50));
        } catch (e) {
          debugPrint('TTS Chunk Playback Error: $e');
        }
      }
    } finally {
      _isPlaying = false;
      // If more chunks arrived while we were in finally, keep playing
      if (_queue.isNotEmpty) {
        _startPlayback();
      } else if (_lastChunkReceived) {
        // All chunks received AND queue drained — safe to signal completion
        debugPrint('TTS: All chunks played, queue drained — firing onPlaybackComplete');
        _lastChunkReceived = false;
        onPlaybackComplete?.call();
      }
    }
  }

  Future<void> stop() async {
    await _player.stop();
    _queue.clear();
    _isPlaying = false;
    _lastChunkReceived = false;
  }

  void dispose() {
    _player.dispose();
  }
}
