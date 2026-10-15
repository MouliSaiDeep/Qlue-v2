import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

abstract interface class PlaybackPort {
  Future<void> stop();
  Future<void> load(AudioSource source);
  Future<void> play();
  Future<void> dispose();
}

class NativePlayback implements PlaybackPort {
  NativePlayback(AudioPlayer player) : _player = player;
  final AudioPlayer _player;
  @override
  Future<void> stop() => _player.stop();
  @override
  Future<void> load(AudioSource source) async { await _player.setAudioSource(source); }
  @override
  Future<void> play() => _player.play();
  @override
  Future<void> dispose() => _player.dispose();
}

class TtsService {
  TtsService({AudioPlayer? player, PlaybackPort? playback}) : _player = playback ?? NativePlayback(player ?? AudioPlayer());
  final PlaybackPort _player;
  int _playbackId = 0;
  Future<void> _playback = Future.value();
  Future<void> _loads = Future.value();
  Completer<void>? _cancel;
  final Map<int,File> _files={};

  Future<void> playUrl(String url) {
    final id = ++_playbackId;
    if (_cancel != null && !_cancel!.isCompleted) _cancel!.complete();
    final cancel = _cancel = Completer<void>();
    return _playback = _run(id, () async => AudioSource.uri(Uri.parse(url)), cancel);
  }

  Future<void> playBase64(String base64Data) {
    final id = ++_playbackId;
    if (_cancel != null && !_cancel!.isCompleted) _cancel!.complete();
    final cancel = _cancel = Completer<void>();
    return _playback = _run(id, () async {
      final bytes = base64Decode(base64Data);
      final tempDir = await getTemporaryDirectory().timeout(const Duration(seconds:5));
      final file = File('${tempDir.path}/qlue_audio_$id.mp3');
      _files[id]=file;
      await file.writeAsBytes(bytes).timeout(const Duration(seconds:5));
      return AudioSource.uri(file.uri);
    }, cancel);
  }

  Future<void> _run(int id, Future<AudioSource> Function() source, Completer<void> cancel) async {
    final previousLoad = _loads;
    final loaded = Completer<void>();
    _loads = loaded.future;
    Future<void> operation() async {
      try {
        await previousLoad;
        if (id != _playbackId) return;
        await _player.stop().timeout(const Duration(seconds:5));
        final audio = await source().timeout(const Duration(seconds:10));
        if (id != _playbackId) return;
        await _player.load(audio).timeout(const Duration(seconds: 30));
        if (!loaded.isCompleted) loaded.complete();
        if (id != _playbackId) return;
        // Installed just_audio play() completes on completion/pause/stop.
        await _player.play().timeout(const Duration(seconds: 60));
      } finally {
        if (!loaded.isCompleted) loaded.complete();
        final file=_files.remove(id); if(file!=null) {try{await file.delete();}catch(_) {}}
      }
    }
    try { await Future.any([operation(), cancel.future]); }
    finally { if (id == _playbackId) { await _player.stop().timeout(const Duration(seconds:5)); _cancel = null; } }
  }

  Future<void> stop() async {
    _playbackId++;
    final cancel = _cancel;
    _cancel = null;
    if (cancel != null && !cancel.isCompleted) cancel.complete();
    await _player.stop().timeout(const Duration(seconds:5));
    await _loads.timeout(const Duration(seconds:45));
    await _player.stop().timeout(const Duration(seconds:5));
  }

  Future<void> waitForCompletion() => _playback;
  void dispose() { stop().then((_) => _player.dispose()).catchError((Object _) {}); }
}
