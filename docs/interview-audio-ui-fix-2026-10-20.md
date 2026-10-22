# Interview UI and microphone candidate — 20 October 2026

The layout in this candidate was subsequently rejected by the user. The current
source restores the exact stable v1.0.9 UI, while retaining the audio changes
below. This document records the earlier noise-fix APK; use the later
`Qlue-1.0.9-stable-ui-aws-stt.apk` candidate for the restored UI.

This candidate addresses the reported moving sphere/transcript, slow first
microphone start, and background-noise words after an answer. AWS Transcribe
and automatic submission after four seconds without detected speech remain.
There is no Done button and no new paid enhancement service.

## Changes

- Question, transcript, status, recovery controls and sphere have reserved
  viewport/text-scale-dependent slots. Hypothesis length, longer questions,
  microphone readiness and notices no longer change their positions. Long
  text scrolls within the slot; small/large-text screens can scroll the stage.
  The existing particle animation and module colors are retained.
- After permission, the native recorder, effects and local detector are
  allocated while idle. The question's single-use access ticket is prefetched
  during playback. No microphone recording or paid Transcribe stream starts
  before question playback stops. Preparation is optional: failure, expiry or
  a different question uses normal issuance. Native idle resources expire
  after 30 seconds and are released when backgrounded/closed.
- Android requests VOICE_COMMUNICATION, falling back on initialization failure.
  Available AcousticEchoCanceler and NoiseSuppressor effects are enabled and
  released with their AudioRecord session. Playback and recording stay separate.
- The pinned MIT/BSD WebRTC VAD wrapper `android-vad:webrtc:2.0.10` runs locally
  on 20-ms frames (16-kHz PCM16 mono, aggressive mode). It gates non-speech with
  160-ms pre-roll and a 240-ms tail to protect word edges. Non-speech is replaced
  with zeros, preserving every sample position and silence duration. Capture
  or transport gaps still fail rather than being disguised as silence.
- Local speech activity resets the four-second timer; loud non-speech and
  transcription hypotheses do not. If the native VAD is unavailable, the
  original PCM/amplitude fallback remains; capability diagnostics distinguish
  that case. There is no blanket low-confidence-word deletion.
- Diagnostics expose readiness time, prepared-ticket use, echo/noise/VAD
  availability and suppressed sample counts. These are recording diagnostics,
  not speaking-confidence scores. Open-source notices are bundled in
  `frontend/assets/licenses/webrtc-vad.txt`.

## Verification

- 61 targeted Flutter tests passed: layout across 412x915, 360x800 and
  320x640/2x text, streaming text, status/notice/phase changes, hands-free timing,
  loud non-speech, resumed speech, prewarm without capture, question-scoped
  tickets, finalization/recovery, replay and account isolation.
- Six Android JVM tests passed: exact PCM chunk/tail offsets and gate behavior
  for synthetic classifier decisions, noise zero-fill, word-edge buffers and
  isolated transients. These do not measure real WebRTC recognition accuracy.
- Flutter static analysis passed. Listening and processing screens were rendered
  and visually checked; the sphere and transcript positions remain fixed.

No test phone was connected. The user chose to test the APK themselves.
Actual first-start latency, quiet speech, room noise, nearby voices, headset
routes and hardware echo/noise effectiveness remain device acceptance checks.
No claim of complete background-speaker removal or measured WER is made.

No backend deployment, user-record modification, Git commit or push is part of
this change. Existing AWS transcription/model/voice/hosting charges remain.

Sources: [Android noise suppression](https://developer.android.com/reference/android/media/audiofx/NoiseSuppressor),
[Android echo cancellation](https://developer.android.com/reference/android/media/audiofx/AcousticEchoCanceler),
[pinned local VAD](https://github.com/gkonovalov/android-vad/tree/2.0.10).

## Built artifact

- `output/Qlue-1.0.9-aws-stt-noise-fix.apk`, 79,630,245 bytes.
- Package `com.qlue.sloths1`, version `1.0.9+10009`, minimum Android API 24.
- SHA-256: `2a7fdb6e40a2eb81a9461eda615cbe9660b5ccda95f95f3b25c9410b2a9ae0e9`.
- Signature verified; signer certificate SHA-256 matches the existing release:
  `cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd`.
- `zipalign -c -P 16 4` passed. VAD JNI libraries are packaged for ARM64,
  ARMv7 and x86_64; the VAD's JNI entry class remains unrenamed by R8.
- The bundled upstream AAR SHA-256 is
  `9af5ed5185b97dd4832d9cf41e7f1d7d11367760d5011689b5e32b8fee073db4`.
  MIT/BSD license notices are present in the APK assets.
- Built with AWS STT enabled, en-IN, stabilization off and a 4,000-ms pause.
  The final native class includes the idle-resource shutdown guard.
- The preceding `output/Qlue-1.0.9-aws-stt.apk` and stable rollback APK remain
  available. Install the candidate as an update, without uninstalling/clearing
  app data. Git HEAD remains `7b9d6f5f16deecb967d3d8224c480a3e15ca32ef`.
