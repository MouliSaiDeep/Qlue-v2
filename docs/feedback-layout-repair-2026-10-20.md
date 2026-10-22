# Feedback and interview layout repair — 20 October 2026

The reported APK was `Qlue-1.0.9-stable-ui-aws-stt.apk`. No Git commit,
push, GitHub release or version-number change is included in this repair.

## Feedback

The affected INTRO interview's original pipeline finished in approximately
12 seconds. Both model responses failed assessment validation, leaving a
terminal unavailable report. Reproduction identified a model evidence quote
containing `[uncertain audio]`. The validator correctly refused to ground a
score in unknown audio, while the frontend retried HTTP 422 for up to about
two minutes and continued showing its loading screen.

The model now selects four reliable excerpt IDs per answer. The server builds
ordered excerpts directly from accepted answer text, masks uncertain spans,
and assigns no ID to unknown audio. References are resolved within their own
answer and checked against the source. The saved report still contains exact
source excerpts and the same server-weighted rubric. Missing or invented IDs
fail validation; malformed output never becomes a default score. Each excerpt
is at most 240 characters. Prompt text also explicitly separates practice
answers from revisions and excludes recognition artifacts from grading.

The frontend stops polling on terminal assessment failures and other permanent
client errors. It uses the existing error view and directs the user to retry
from History. Transient errors and genuine pending reports retain polling.

The specific failed interview was regenerated through the deployed,
ownership-checked regeneration handler. The normal DynamoDB stream / delayed
queue / SNS pipeline completed, stored a canonical report, and the deployed
session-detail handler returned HTTP 200 with `analysisStatus: OK`.
This verifies completion and grounding; it does not establish human-calibrated
scoring accuracy. The existing `NOT_HUMAN_CALIBRATED` label remains.

## Deployment

Only `AnalyzeTranscriptFunction.Properties.Code` changed in the CloudFormation
template. The packaged source differs from the preceding deployment only in
`lib/feedbackAssessment.js`.

- Stack `qlue-dev`: `UPDATE_COMPLETE`.
- Analysis Lambda package SHA-256, base64:
  `BjcGsDjoCf4U4VG8l9bUdiF4ot0Xnb996br7diAM+bY=`.
- Other 60 Lambdas retain the preceding package. Environment variables, IAM
  role, layers, runtime, handler, memory and timeout of the analysis Lambda
  were compared with the live snapshot and preserved.
- Ten interviews per user per UTC day and existing provider/audio allowances
  are unchanged. The audio gateway was not redeployed.
- Rollback template, function configuration, private diagnostic records,
  change-set details and recovery verification are retained under ignored
  `tmp/feedback-layout-fix-20261020/private/`.

Automatic approval review initially rejected the change set because
CloudFormation listed six dependent resources. Additional checks proved their
declarations were byte-identical and their changes were reference propagation
through unchanged ARNs. No IAM policy, API body or SNS endpoint declaration
changed. The same deployment subsequently passed review and executed.

## Interview layout

GitHub's `v1.0.9` release was verified live: tag target
`a679916221e02df082e9d955b2441be4e345411e`.
The installed candidate already contained the four UI sources from that tag.
Rendering exposed the smaller-phone issue: a safe viewport below 780 logical
pixels selected a compact layout that placed the ball and transcript high on
the screen, leaving excessive unused space below.

The stable visual components, typography, colors, header, question text,
transcript viewport and controls remain. The compact breakpoint is now 640
logical pixels or large accessibility text. Recording notices no longer
switch layout modes mid-answer. This is a small placement correction to the
stable source, not a byte-identical restoration of the entire screen file.
AWS transcription, automatic submission after the existing silence interval,
prewarming, local noise controls and the absence of a Done button are preserved.

## Validation

- Backend: 72 suites, 541 tests covered by the full run and rerunning the two
  updated model-response fixture suites. Evidence-reference regressions cover
  mid-sentence uncertain audio, foreign IDs, fabricated quotes and absent
  positive-level evidence.
- Flutter: 10 targeted regression tests passed; two additional rendering
  checks passed at 360×800 and 412×915 with safe-area insets. Existing
  320×640 / 2× accessibility-text coverage passed.
- Flutter static analysis: no issues.
- Real failed interview: regenerated to `COMPLETE`; deployed report handler
  returned HTTP 200. Private transcript content is excluded from this document.
- Device microphone, hardware noise suppression and final phone appearance
  remain user acceptance checks; no Android device was connected.

## APK

- `output/Qlue-1.0.9-feedback-layout-fix.apk` — release build,
  `com.qlue.sloths1`, version `1.0.9+10009`, minimum Android API 24.
- SHA-256:
  `a01247a580a60ab20dde50e34b5cbbe0c191e44a2a9e55242b19e5926f568ca2`.
- Signature verified against the existing release certificate:
  `cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd`.
- 16-KiB zip alignment checked. AWS STT enabled, `en-IN`, stabilization off,
  existing 4,000-ms silence interval.
- Install as an update. The preceding APK remains available for rollback.
