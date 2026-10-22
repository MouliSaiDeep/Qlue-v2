/// Stable user messages for known voice-service failures. Raw provider errors
/// never become UI copy. Unknown/transient failures retain bounded recovery.
class SpeechFailure {
  const SpeechFailure(this.message, {this.terminal = false});
  final String message;
  final bool terminal;

  static SpeechFailure? fromCode(String code) {
    if (code.contains('permission')) {
      return const SpeechFailure(
        'Microphone permission is denied. Enable it in device settings before starting an interview.',
        terminal: true,
      );
    }
    switch (code) {
      case 'STREAM_DAILY_LIMIT':
        return const SpeechFailure(
          'Your daily voice limit has been reached. Your draft is kept in this session. End the interview and try again after the daily reset.',
          terminal: true,
        );
      case 'STREAM_CAPACITY':
      case 'STREAM_CAPACITY_OR_BUDGET': // Older gateway versions.
        return const SpeechFailure(
          'The voice service is busy. Retrying automatically; your microphone stays off until a connection is ready.',
        );
      case 'AWS_STT_DISABLED':
        return const SpeechFailure(
          'Voice interviews are temporarily paused. Your draft is kept in this session. Please end the interview and try again later.',
          terminal: true,
        );
      case 'audio_startup_timeout':
        return const SpeechFailure(
          'The voice service could not start in time. Retrying automatically; your draft is kept.',
        );
      default:
        return null;
    }
  }
}
