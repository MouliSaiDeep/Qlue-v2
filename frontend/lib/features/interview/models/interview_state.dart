enum InterviewPhase {
  ready,
  speaking,
  listening,
  processing,
  reconnecting,
  error,
}

class TranscriptEntry {
  final String role;
  final String text;
  final DateTime timestamp;

  TranscriptEntry({
    required this.role,
    required this.text,
    required this.timestamp,
  });
}
