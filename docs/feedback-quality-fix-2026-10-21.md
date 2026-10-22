# Feedback quality repair — 21 October 2026

This repair addresses the two reviewed INTRO reports, repetitive criticism,
completion-praise placeholders, generic summaries and unexplained scores.
The interview screen, transcription behavior and application version remain
as in the preceding candidate. No Git commit or GitHub push is included.

## Assessment and coaching

- Answer pairing now uses speaker plus event ID. A USER answer and the AI
  follow-up legitimately share an event ID; one can no longer overwrite the
  other before grading. Missing or conflicting accepted pairs fail closed.
- The evaluator explains each criterion before assigning its bounded level.
  The server retains the existing weights and computes the overall mark.
  No minimum score, score boost or forced variation between dimensions is used.
- INTRO uses a stable, server-owned self-introduction task. An arbitrary coach
  suggestion about a target role is not treated as an actual job description.
  Evidence anchors distinguish naming a project from explaining personal
  contribution and a result or learning. Numerical outcomes are not required.
- Grading uses reliable text excerpts. Omitted uncertain audio has no evidence
  ID. The original text, ASR metadata and accepted answer manifest are preserved.
- Strengths can acknowledge specific demonstrated content even when a criterion
  needs improvement. Weaknesses identify an actual gap, paired with an actionable
  next step. Duplicate and strongly overlapping points are grouped. Completion
  praise is rejected; fully met criteria do not invent extra requirements.
- Every displayed criterion receives a reason, weight, actual score and source
  evidence. A source quote proves where text came from, not that every model
  interpretation is correct; semantic evaluation remains necessary.
- The summary describes the graded answer's content and main priority. INTRO
  coaching evaluates the final introduction. If the model omits the ungraded
  practice baseline, comparison is explicitly unavailable; it is never presented
  as a zero baseline or invented improvement.

The existing Bedrock model is unchanged. Normal generation uses one model call,
with at most one application retry and no nested provider retries. Richer feedback
uses more output tokens than the previous minimal level/reference response.
It does not add a new provider, hosting service or emotion-analysis charge.
The maximum evaluation deadline and operational budget guards remain in place.

The response schema requires both scoring and coaching, with a separate
unavailable branch. Fixed criterion keys prevent an aggregate review from
silently becoming a variable-length per-answer list. Application validation
still checks ownership, IDs, cardinality, levels, evidence and text bounds.
This uses the supported JSON Schema subset documented by
[Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).

## Screen and PDF

The existing dark glass style and navigation are retained. The score section
uses full-width rows for every real criterion instead of a three-axis chart
and fabricated default metrics. Each row shows its score out of 100, weight,
reason and expandable answer evidence. The overall score is identified as a
practice assessment of answer content.

The unsupported candidate-percentile badge, empty-strength congratulations,
and PDF's hardcoded high-confidence/steady-pace statements are removed. PDF
exports include the real criterion explanations. Narrow layouts and 2× text
use wrapping controls and vertically arranged score content.

## Validation

- Backend: 74 suites, 554 tests passed, including shared speaker IDs, ambiguous
  pairs, owned refreshes, retry quotas, missing/foreign coaching references,
  omitted baselines and canonical persistence of score reasons.
- Flutter: score-layout, legacy parsing, failure handling and PDF checks cover
  all four dimensions and 320×640 at 2× text. Rendered score and explanation
  views were inspected. Flutter static analysis reported no issues before the
  final text-contrast and PDF wording corrections; targeted tests were repeated
  after those corrections.
  All 16 targeted Flutter checks passed after the final changes; one additional
  rendered-layout test passed.
- Live evaluation used the same two saved interviews plus a strong/weak
  introduction pair and a correct/incorrect HTTP explanation pair. The final
  control responses separated factual correctness from understandable language,
  preserved zero grades where deserved, and did not invent weaknesses for the
  fully supported introduction.
- The two actual saved-answer evaluations produced 85 and 75 with distinct
  criterion reasons. These are diagnostic evaluations, not manually assigned
  replacements or proof of psychometric accuracy. Production regeneration is
  separately checked after deployment.

The current metadata remains `NOT_HUMAN_CALIBRATED`. These cases are regression
checks, not a validated research benchmark or evidence of an accurate speaking
confidence measure. Device appearance and real-room recording remain user
acceptance checks; no test phone was connected.

## Deployment and recovery

Only four Lambda code properties change: TriggerFeedbackGeneration,
AnalyzeTranscript, GenerateFeedbackReport and RegenerateFeedback. The packaged
source delta consists of the assessment library, new coaching library, analysis
handler and explicit legacy-refresh handling. Function environment variables,
roles, policies, API/subscription definitions, layers and timeouts are preserved.
The ten-interviews-per-user-per-UTC-day policy and provider/audio limits remain.

Package SHA-256 (base64):
`OhrNr7HGG21oWYPWI0xFIWcGtuFVzejX8gwQphIX/jY=`.

The owning CloudFormation stack applies the code update. Reference propagation
entries in the change set have byte-identical declarations; scope checks reject
direct changes outside the four Code properties and unexpected replacements.
Current templates/configurations and original reports are retained in ignored
`tmp/feedback-quality-fix-20261021/private/` for rollback and audit.

The maintenance refresh uses `refreshAssessment: true` on the existing internal
regeneration handler with the verified owned-session identity. No new public
API route is introduced. It retains account-deletion checks, per-user retry quotas and
attempt fencing. Current coaching reports are not repeatedly regenerated by
this refresh operation, and older report rows are retained.

## Verified release result

- `qlue-dev` completed the update. Four function code hashes and all their
  existing configuration fields were verified against the live snapshot.
  All 61 function ARNs and the other 57 code packages remain unchanged.
- Both owned reports regenerated through the actual stream/queue/SNS/model/
  formatter/storage pipeline. The deployed report handler returned HTTP 200
  for each. The saved reports contain three specific strengths each, three
  and two improvement points respectively, summaries and four score explanations.
- Persisted production marks are **71.3** and **68.8**. Diagnostic evaluations
  of the saved text produced different marks, illustrating model sensitivity;
  these are AI practice estimates, not calibrated measurements. Stored marks
  remain stable when viewing a report; completed current reports are not
  rescored on each view.
- The original report rows remain available for rollback. No raw transcript
  or accepted-answer record was altered.
- APK: `output/Qlue-1.0.9-feedback-quality.apk`, 79,941,633 bytes,
  `com.qlue.sloths1`, version `1.0.9+10009`, minimum Android API 24.
- APK SHA-256:
  `00804fe2de7cbee1251713eea114a4239b0edd1a5e953243c3a4ebf6ff8050e0`.
- Release signature and 16-KiB ZIP alignment verified. Certificate SHA-256:
  `cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd`.
- AWS STT, automatic answer submission, prewarming and local noise controls
  remain enabled. Interview layout sources were not changed by this repair.
- Ten interviews per user per UTC day and the existing per-user provider guard
  were checked across all 61 function configurations. No commit or push occurred.
