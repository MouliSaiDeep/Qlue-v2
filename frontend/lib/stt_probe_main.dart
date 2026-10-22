// Isolated debug-only device harness. Never imported by main.dart.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'shared/services/aws_pcm_source.dart';
import 'shared/services/aws_transcribe_stt_service.dart';
import 'shared/services/system_speech_stt_service.dart';

void main() {
  if (!kDebugMode || !const bool.fromEnvironment('AWS_STT_LOOPBACK_PROBE')) {
    throw StateError('Debug probe build required');
  }
  runApp(const MaterialApp(home: SttProbe()));
}

class ProbeSource extends AwsPcmSource {
  final source = NativeAwsPcmSource();
  final chunks = <Uint8List>[];
  int frames = 0, clipped = 0;
  double maxRms = 0;
  @override
  Stream<Map<String, dynamic>> get events => source.events.map((e) {
    if (e['type'] == 'pcm') {
      chunks.add(e['pcm'] as Uint8List);
      frames++;
      clipped += (e['clippedSamples'] as int);
      maxRms = maxRms > (e['rms'] as num)
          ? maxRms
          : (e['rms'] as num).toDouble();
    }
    return e;
  });
  @override
  Future<bool> initialize() => source.initialize();
  @override
  Future<void> start(int epoch) => source.start(epoch);
  @override
  Future<void> stop(int epoch) => source.stop(epoch);
  @override
  void ack(int epoch) => source.ack(epoch);
}

class SttProbe extends StatefulWidget {
  const SttProbe({super.key});
  @override
  State<SttProbe> createState() => _SttProbeState();
}

class _SttProbeState extends State<SttProbe> {
  AwsTranscribeSttService? service;
  ProbeSource? source;
  SystemSpeechSttService? system;
  String state = 'Ready', transcript = '';
  bool busy = false, recording = false;
  final clock = Stopwatch();
  final timings = <String, double>{};
  Future<Map<String, dynamic>> request(
    String path,
    Map<String, dynamic> body,
  ) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
    try {
      final req = await client.postUrl(Uri.parse('http://127.0.0.1:8788$path'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode(body));
      final res = await req.close().timeout(const Duration(seconds: 10));
      final data = jsonDecode(await utf8.decoder.bind(res).join());
      if (res.statusCode != 200) {
        throw StateError('probe_request_failed_${res.statusCode}');
      }
      return Map<String, dynamic>.from(data as Map);
    } finally {
      client.close(force: true);
    }
  }

  Future<void> start() async {
    if (busy || recording) return;
    service?.dispose();
    source = ProbeSource();
    timings.clear();
    clock.reset();
    clock.start();
    setState(() {
      busy = true;
      state = 'Connecting';
      transcript = '';
    });
    final current = service = AwsTranscribeSttService(
      source: source,
      automaticCompletion: false,
      issueTicket: (r) => request('/ticket', r),
    );
    current.setQuestionContext(
      sessionId: 'synthetic-phone',
      turnId: 'staging-question',
    );
    current.configureCapture(
      identity: 'synthetic-phone:staging-question',
      preserve: false,
      onActivity: (_) {},
      onEndpoint: () {},
    );
    try {
      await current.startListening(
        onPartial: (text) {
          timings.putIfAbsent(
            'firstPartialFromStartMs',
            () => clock.elapsedMicroseconds / 1000,
          );
          if (mounted) setState(() => transcript = text);
        },
        onFinal: (text) {
          timings['lastFinalFromStartMs'] = clock.elapsedMicroseconds / 1000;
          if (mounted) setState(() => transcript = text);
        },
        onStatus: (s) {
          if (mounted) setState(() => state = s);
        },
        onError: (e) {
          if (mounted) setState(() => state = 'Interrupted: ${e.errorMsg}');
          unawaited(report(false, e.errorMsg));
        },
      );
      if (mounted) {
        setState(() {
          busy = false;
          recording = true;
          state = 'Recording — speak, then press Stop';
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          busy = false;
          state = 'Error: $e';
        });
      }
      await report(false, e.toString());
    }
  }

  Future<void> stop() async {
    if (busy || !recording) return;
    setState(() => busy = true);
    timings['stopRequestedMs'] = clock.elapsedMicroseconds / 1000;
    try {
      await service!.stopCaptureAndFlush();
      timings['completeMs'] = clock.elapsedMicroseconds / 1000;
      await report(true, null);
      if (mounted) {
        setState(() => state = 'Complete — ${source!.frames} PCM frames');
      }
    } catch (e) {
      await report(false, e.toString());
      if (mounted) setState(() => state = 'Interrupted: $e');
    }
    if (mounted) {
      setState(() {
        busy = false;
        recording = false;
      });
    }
  }

  Future<void> report(bool complete, String? error) async {
    try {
      final pcm = BytesBuilder(copy: false);
      for (final chunk in source?.chunks ?? <Uint8List>[]) {
        pcm.add(chunk);
      }
      await request('/report', {
        'complete': complete,
        'error': error,
        'frames': source?.frames,
        'clippedSamples': source?.clipped,
        'maxRms': source?.maxRms,
        'transcript': transcript,
        'timings': timings,
        'pcmBase64': base64Encode(pcm.takeBytes()),
      });
    } catch (_) {
      if (mounted) setState(() => state = '$state; report unavailable');
    }
  }

  Future<void> replaySystem() async {
    if (busy || recording || source == null || source!.chunks.isEmpty) return;
    setState(() {
      busy = true;
      state = 'Preparing identical recording for Android recognition';
    });
    await service?.stopCapture();
    service?.dispose();
    final directory = await getExternalStorageDirectory();
    if (directory == null) {
      setState(() {
        busy = false;
        state = 'External app storage unavailable';
      });
      return;
    }
    final bytes = BytesBuilder(copy: false);
    for (final c in source!.chunks) {
      bytes.add(c);
    }
    await File(
      '${directory.path}/sttprobe.pcm',
    ).writeAsBytes(bytes.takeBytes(), flush: true);
    final current = system = SystemSpeechSttService(
      source: NativeSystemSpeechSource(reviewFixture: true),
    );
    String recognized = '';
    bool ending = false;
    Timer? timeout;
    Future<void> finish([String? failure]) async {
      if (ending) return;
      ending = true;
      timeout?.cancel();
      try {
        await current.stopCaptureAndFlush().timeout(const Duration(seconds: 8));
      } catch (_) {
        failure ??= 'system_finalization_failed';
      }
      await request('/system-report', {
        'complete': failure == null && !current.hasUnconfirmedSpeech,
        'error': failure,
        'transcript': recognized,
        'provider': 'android-system',
        'language': 'en-IN',
        'sameRecording': true,
      });
      current.dispose();
      if (mounted) {
        setState(() {
          busy = false;
          state = failure == null
              ? 'Android replay complete'
              : 'Android replay unavailable: $failure';
          transcript = recognized;
        });
      }
    }

    current.configureCapture(
      identity: 'system-probe',
      preserve: false,
      onActivity: (_) {},
      onEndpoint: () => unawaited(finish()),
    );
    try {
      await current.startListening(
        onPartial: (text) {
          recognized = text;
          if (mounted) setState(() => transcript = text);
        },
        onFinal: (text) {
          recognized = text;
          if (mounted) setState(() => transcript = text);
        },
        onError: (e) => unawaited(finish(e.errorMsg)),
      );
      timeout = Timer(
        const Duration(seconds: 25),
        () => unawaited(finish('system_replay_timeout')),
      );
    } catch (_) {
      await finish('system_replay_unsupported');
    }
  }

  @override
  void dispose() {
    service?.dispose();
    system?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Qlue STT Probe — staging only')),
    body: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Microphone audio goes to Amazon Transcribe in us-east-1 through the USB loopback test gateway. This is a separate test app; production stays disabled.',
          ),
          const SizedBox(height: 20),
          Text(state, key: const Key('probe-state')),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: busy || recording ? null : start,
            child: const Text('Start microphone test'),
          ),
          ElevatedButton(
            onPressed: busy || !recording ? null : stop,
            child: const Text('Stop and finish'),
          ),
          ElevatedButton(
            onPressed: busy || recording || source == null
                ? null
                : replaySystem,
            child: const Text('Replay same audio with Android'),
          ),
          const SizedBox(height: 20),
          Expanded(
            child: SingleChildScrollView(child: SelectableText(transcript)),
          ),
        ],
      ),
    ),
  );
}
