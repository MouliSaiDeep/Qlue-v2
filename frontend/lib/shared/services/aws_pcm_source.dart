import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';

abstract class AwsPcmSource {
  Stream<Map<String, dynamic>> get events;
  Future<bool> initialize();
  Future<void> prepare() async {}
  Future<void> start(int epoch);
  Future<void> stop(int epoch);
  void ack(int epoch);
}

class NativeAwsPcmSource implements AwsPcmSource {
  static const _control = MethodChannel('qlue/aws_pcm/control');
  static const _events = EventChannel('qlue/aws_pcm/frames');
  @override
  Stream<Map<String, dynamic>> get events => _events
      .receiveBroadcastStream()
      .map((e) => Map<String, dynamic>.from(e as Map));
  @override
  Future<bool> initialize() async =>
      await const MethodChannel(
            'qlue/interview_audio/control',
          ).invokeMethod<bool>('permission') ==
          true &&
      await _control.invokeMethod<bool>('available') == true;
  @override
  Future<void> start(int epoch) =>
      _control.invokeMethod('start', {'epoch': epoch});
  @override
  Future<void> prepare() => _control.invokeMethod('prepare');
  @override
  Future<void> stop(int epoch) =>
      _control.invokeMethod('stop', {'epoch': epoch});
  @override
  void ack(int epoch) {
    unawaited(
      _control
          .invokeMethod<void>('ack', {'epoch': epoch})
          .catchError((Object _) {}),
    );
  }
}

abstract class AwsAudioTransport {
  Stream<Map<String, dynamic>> get events;
  Future<void> connect(Map<String, dynamic> ticket);
  void audio(Uint8List pcm, int sequence, int offsetSamples);
  void end(int frames, int nextOffsetSamples);
  Future<void> cancel();
}

/// Socket, framing and JSON decoding run on an IO isolate, away from rendering.
class IsolateAwsAudioTransport implements AwsAudioTransport {
  final _events = StreamController<Map<String, dynamic>>.broadcast(sync: true);
  Isolate? _isolate;
  ReceivePort? _receive;
  SendPort? _send;
  @override
  Stream<Map<String, dynamic>> get events => _events.stream;
  @override
  Future<void> connect(Map<String, dynamic> ticket) async {
    final uri = Uri.parse(ticket['gatewayUrl'] as String);
    const probe = bool.fromEnvironment(
      'AWS_STT_LOOPBACK_PROBE',
      defaultValue: false,
    );
    final loopback =
        kDebugMode &&
        probe &&
        uri.scheme == 'ws' &&
        uri.host == '127.0.0.1' &&
        uri.port == 8788;
    if ((uri.scheme != 'wss' && !loopback) ||
        uri.path != '/audio' ||
        uri.hasQuery ||
        uri.userInfo.isNotEmpty) {
      throw StateError('invalid_audio_endpoint');
    }
    final ready = Completer<void>();
    _receive = ReceivePort();
    _receive!.listen((dynamic message) {
      if (message is SendPort) {
        _send = message;
        return;
      }
      final event = Map<String, dynamic>.from(message as Map);
      if (event['type'] == 'ready' && !ready.isCompleted) ready.complete();
      if (event['type'] == 'error' && !ready.isCompleted) {
        ready.completeError(StateError(event['code'].toString()));
      }
      _events.add(event);
    });
    _isolate = await Isolate.spawn(_network, {
      'port': _receive!.sendPort,
      'url': uri.toString(),
      'ticket': ticket['ticket'],
    });
    try {
      await ready.future.timeout(const Duration(seconds: 12));
    } catch (_) {
      await cancel();
      rethrow;
    }
  }

  @override
  void audio(Uint8List pcm, int sequence, int offsetSamples) =>
      _send?.send({'pcm': pcm, 'sequence': sequence, 'offset': offsetSamples});
  @override
  void end(int frames, int nextOffsetSamples) =>
      _send?.send({'end': true, 'frames': frames, 'offset': nextOffsetSamples});
  @override
  Future<void> cancel() async {
    _send?.send({'cancel': true});
    _isolate?.kill(priority: Isolate.immediate);
    _isolate = null;
    _receive?.close();
    _receive = null;
    _send = null;
    await _events.close();
  }
}

void _network(Map<String, dynamic> args) async {
  final out = args['port'] as SendPort, input = ReceivePort();
  out.send(input.sendPort);
  WebSocket? socket;
  int sent = 0, acknowledged = -1;
  bool completed = false;
  final clock = Stopwatch()..start();
  double? firstAudioAt;
  void fail(String code) {
    out.send({'type': 'error', 'code': code});
    unawaited(socket?.close());
    input.close();
  }

  try {
    socket = await WebSocket.connect(
      args['url'] as String,
    ).timeout(const Duration(seconds: 8));
    socket.pingInterval = const Duration(seconds: 15);
    socket.add(
      jsonEncode({'type': 'start', 'protocol': 1, 'ticket': args['ticket']}),
    );
    socket.listen(
      (dynamic data) {
        try {
          if (data is! String || data.length > 256000) {
            throw StateError('invalid_audio_event');
          }
          final event = Map<String, dynamic>.from(jsonDecode(data) as Map);
          if (firstAudioAt != null) {
            event['clientReceivedMsSinceFirstAudio'] =
                clock.elapsedMicroseconds / 1000 - firstAudioAt!;
          }
          if (event['type'] == 'ack') {
            if (event['sequence'] != acknowledged + 1 ||
                event['sequence'] >= sent) {
              throw StateError('audio_ack_gap');
            }
            acknowledged++;
          }
          if (event['type'] == 'complete' ||
              event['type'] == 'interrupted' ||
              event['type'] == 'error') {
            completed = true;
          }
          out.send(event);
        } catch (_) {
          fail('audio_protocol_error');
        }
      },
      onDone: () {
        if (!completed) {
          out.send({'type': 'error', 'code': 'audio_disconnected'});
        }
        input.close();
      },
      onError: (Object _) => fail('audio_disconnected'),
    );
    input.listen((dynamic raw) {
      final message = raw as Map;
      try {
        if (message['cancel'] == true) {
          socket?.add(jsonEncode({'type': 'cancel'}));
          unawaited(socket?.close());
          input.close();
          return;
        }
        if (message['end'] == true) {
          socket?.add(
            jsonEncode({
              'type': 'end',
              'frames': message['frames'],
              'nextOffsetSamples': message['offset'],
            }),
          );
          return;
        }
        if (sent - acknowledged > 20) throw StateError('audio_backpressure');
        final pcm = message['pcm'] as Uint8List;
        if (pcm.isEmpty ||
            pcm.length > 2560 ||
            pcm.length.isOdd ||
            message['sequence'] != sent) {
          throw StateError('invalid_pcm');
        }
        final bytes = Uint8List(12 + pcm.length),
            header = ByteData.sublistView(bytes);
        header.setUint32(0, sent, Endian.little);
        header.setUint64(4, message['offset'] as int, Endian.little);
        bytes.setAll(12, pcm);
        socket?.add(bytes);
        firstAudioAt ??= clock.elapsedMicroseconds / 1000;
        sent++;
      } catch (_) {
        fail('audio_backpressure_or_gap');
      }
    });
  } catch (_) {
    fail('audio_connection_failed');
  }
}
