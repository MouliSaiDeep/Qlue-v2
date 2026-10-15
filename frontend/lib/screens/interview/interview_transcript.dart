import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../features/interview/providers/interview_provider.dart';

/// A reserved viewport keeps recognition updates from moving the whole screen.
class InterviewTranscript extends StatelessWidget {
  const InterviewTranscript({super.key});

  @override
  Widget build(BuildContext context) => Selector<InterviewProvider, String>(
    selector: (_, p) => p.partialTranscript.isNotEmpty
        ? p.partialTranscript
        : p.finalTranscript,
    builder: (_, text, _) => LiveTranscriptViewport(text: text),
  );
}

class LiveTranscriptViewport extends StatefulWidget {
  const LiveTranscriptViewport({super.key, required this.text});
  final String text;

  @override
  State<LiveTranscriptViewport> createState() => _LiveTranscriptViewportState();
}

class _LiveTranscriptViewportState extends State<LiveTranscriptViewport> {
  final _scroll = ScrollController();
  bool _follow = true;
  bool _queued = false;

  @override
  void didUpdateWidget(LiveTranscriptViewport oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.text == widget.text) return;
    if (widget.text.isEmpty) _follow = true;
    if (!_follow || _queued) return;
    _queued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _queued = false;
      if (mounted && _follow && _scroll.hasClients) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
    child: SizedBox(
      key: const Key('interview-transcript-viewport'),
      width: double.infinity,
      height: 100,
      child: NotificationListener<ScrollUpdateNotification>(
        onNotification: (notification) {
          if (notification.dragDetails != null) {
            _follow = notification.metrics.extentAfter < 24;
          }
          return false;
        },
        child: SingleChildScrollView(
          controller: _scroll,
          child: Text(
            widget.text,
            style: TextStyle(
              fontSize: 14,
              fontFamily: 'monospace',
              fontWeight: FontWeight.w500,
              color: Colors.orangeAccent.withValues(alpha: 0.8),
              height: 1.4,
              letterSpacing: -0.3,
            ),
            textAlign: TextAlign.center,
          ),
        ),
      ),
    ),
  );
}
