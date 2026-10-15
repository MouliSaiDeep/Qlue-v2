class AnswerAudio {
  const AnswerAudio(this.path, this.fileSize, {this.captureSegments});
  final String path;
  final int fileSize;

  /// PCM sample counts for contiguous captures, excluding recognizer restart gaps.
  final List<int>? captureSegments;
}
