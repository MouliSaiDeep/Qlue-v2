import 'package:flutter/material.dart';
import '../../features/interview/providers/interview_provider.dart';

/// Answering/recovery require no taps. Replay is optional after reconciliation.
/// The interview screen retains its separate End control.
class InterviewRecoveryControls extends StatelessWidget {
  const InterviewRecoveryControls({super.key, required this.provider});
  final InterviewProvider provider;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 20),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (provider.recordingNotice != null)
          Text(
            provider.recordingNotice!,
            style: const TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        if (provider.replayQuestionAvailable)
          TextButton.icon(
            key: const Key('replay-question'),
            onPressed: provider.canReplayQuestion
                ? provider.replayQuestion
                : null,
            icon: const Icon(Icons.replay, color: Colors.white),
            label: const Text(
              'Replay question',
              style: TextStyle(color: Colors.white),
            ),
          ),
        if (provider.currentPhase == InterviewPhase.processing)
          Text(
            provider.isFinalizingTranscript
                ? 'Finishing your transcript…'
                : 'Preparing your next response…',
            style: const TextStyle(color: Colors.white),
          ),
        if (provider.currentPhase == InterviewPhase.reconnecting)
          const Text(
            'Reconnecting to your interview…',
            style: TextStyle(color: Colors.white),
          ),
        if (provider.errorMessage != null)
          Text(
            provider.errorMessage!,
            key: const Key('interview-error'),
            style: const TextStyle(color: Colors.orangeAccent),
            textAlign: TextAlign.center,
          ),
        if (provider.currentPhase == InterviewPhase.listening)
          const Text(
            'Speak naturally. Pauses under 4 seconds stay in your answer; 4 seconds of silence submits it.',
            style: TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        if (provider.currentPhase == InterviewPhase.listening &&
            !provider.isListening)
          Text(
            provider.isPreparingVoice
                ? 'Preparing voice service… Your microphone stays off until it is ready.'
                : 'Getting microphone ready…',
            style: TextStyle(color: Colors.white70),
          ),
      ],
    ),
  );
}
