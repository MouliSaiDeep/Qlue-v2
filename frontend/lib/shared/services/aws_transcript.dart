/// AWS recognition evidence. Confidence, Stable and finality are distinct.
class AsrWord {
  const AsrWord(this.text, this.start, this.end, this.confidence, this.stable);
  final String text;
  final double? start, end, confidence;
  final bool? stable;
  factory AsrWord.fromJson(Map<String, dynamic> j) {
    double? number(dynamic n) => n is num && n.isFinite ? n.toDouble() : null;
    final c = number(j['confidence']);
    return AsrWord(
      j['text'] as String,
      number(j['start']),
      number(j['end']),
      c != null && c >= 0 && c <= 1 ? c : null,
      j['stable'] as bool?,
    );
  }
}

class AsrSegment {
  AsrSegment.fromJson(Map<String, dynamic> j)
    : provider = j['provider'] as String,
      language = j['language'] as String,
      streamId = j['streamId'] as String,
      captureId = j['captureId'] as String,
      sessionId = j['sessionId'] as String,
      turnId = j['turnId'] as String,
      epoch = j['epoch'] as int,
      resultId = j['resultId'] as String,
      partial = j['partial'] as bool,
      text = j['text'] as String,
      start = (j['start'] as num?)?.toDouble(),
      end = (j['end'] as num?)?.toDouble(),
      offsetSamples = j['offsetSamples'] as int,
      words = (j['words'] as List)
          .map((w) => AsrWord.fromJson(Map<String, dynamic>.from(w)))
          .toList();
  final String provider,
      language,
      streamId,
      captureId,
      sessionId,
      turnId,
      resultId,
      text;
  final int epoch, offsetSamples;
  final bool partial;
  final double? start, end;
  final List<AsrWord> words;
}

class AwsTranscript {
  AwsTranscript({
    required this.streamId,
    required this.epoch,
    required this.captureId,
    required this.sessionId,
    required this.turnId,
  });
  final String streamId, captureId, sessionId, turnId;
  final int epoch;
  final Map<String, AsrSegment> _segments = {};
  bool accept(AsrSegment s) {
    if (s.provider != 'aws-transcribe' ||
        s.streamId != streamId ||
        s.epoch != epoch ||
        s.captureId != captureId ||
        s.sessionId != sessionId ||
        s.turnId != turnId) {
      return false;
    }
    if (_segments[s.resultId]?.partial == false) return false;
    if (_segments.length >= 500 && !_segments.containsKey(s.resultId)) {
      throw StateError('transcript_limit');
    }
    _segments[s.resultId] = s;
    return true;
  }

  List<AsrSegment> get ordered =>
      _segments.values.toList()
        ..sort((a, b) => (a.start ?? 0).compareTo(b.start ?? 0));
  String get finalized => ordered
      .where((s) => !s.partial)
      .map((s) => s.text)
      .where((s) => s.isNotEmpty)
      .join(' ');
  String get provisional =>
      ordered.where((s) => s.partial).map((s) => s.text).join(' ');
  String get display =>
      ordered.map((s) => s.text).where((s) => s.isNotEmpty).join(' ');
  List<AsrWord> get finalizedWords =>
      ordered.where((s) => !s.partial).expand((s) => s.words).toList();
  void reconcileFinalSnapshot(List<dynamic> segments, String expectedText) {
    final replacement = AwsTranscript(
      streamId: streamId,
      epoch: epoch,
      captureId: captureId,
      sessionId: sessionId,
      turnId: turnId,
    );
    for (final raw in segments) {
      final s = AsrSegment.fromJson(Map<String, dynamic>.from(raw as Map));
      if (s.partial || !replacement.accept(s)) {
        throw StateError('invalid_final_snapshot');
      }
    }
    if (replacement.finalized != expectedText) {
      throw StateError('incomplete_final_snapshot');
    }
    _segments
      ..clear()
      ..addAll(replacement._segments);
  }

  Map<String, dynamic> confidenceSummary() {
    final words = finalizedWords,
        known = words.where((w) => w.confidence != null).toList();
    return {
      'mean': known.isEmpty
          ? null
          : known.fold<double>(0, (sum, w) => sum + w.confidence!) /
                known.length,
      'missing': words.length - known.length,
      'words': words.length,
      'threshold': 0.80,
      'calibrated': false,
      'label': 'recognition-confidence-not-accuracy',
    };
  }
}
