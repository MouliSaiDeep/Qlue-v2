/// Premium voices can be browsed, but cannot be selected or synthesized.
abstract final class VoicePolicy {
  static const defaultVoice = 'Ruth';
  static const standardVoices = {'Ruth', 'Joanna', 'Matthew', 'Stephen'};
  static String resolve(String? voice) =>
      standardVoices.contains(voice) ? voice! : defaultVoice;
}
