# Feedback, voice and profile update — 21 October 2026

## Behavior

- Ruth is the default on the client, profile API, interview initialization and speech synthesis. Existing standard choices remain available. Legacy Tiffany/premium preferences resolve to Ruth/neural.
- Opening Premium only changes which catalog is visible. Tiffany is displayed with a lock and cannot be selected. Its preview uses an existing bundled audio asset. The profile API rejects premium updates; generative synthesis is blocked even for old sessions or legacy environment opt-ins.
- Profile shows the account email beneath the name and profession, replacing “Interview Ready.” The separate email row and Change Password dialog are removed. The existing secure Reset Password flow remains available in login and profile.
- Feedback uses criterion score rings, introduction progress or answer-by-answer bars when supported by saved assessment data, compact summary text, and accessible detail sheets. Evidence and transcripts remain available without expanding a long dropdown. The interview screen layout is unchanged.

## Feedback repairs

Explicit whole-utterance name corrections are preserved as conversation records, but do not consume a scored answer or advance the current question. A correction mixed with substantive interview content stays eligible for assessment. Existing accepted corrections are excluded during preparation and recorded in `assessment.excludedAnswers`. The follow-up repeats the actual current question, omitting any earlier greeting or incorrect name.

The interviewer context masks server-verified extremely uncertain recognition spans, including the misrecognized name observed in this review. Raw transcript evidence remains intact for audit. Recognition confidence is not treated as word accuracy or speaking confidence.

Single-word recognition fragments such as “I.” cannot be selected as supporting evidence. Introduction evidence at the highest level requires references for a specific personal action and an outcome/learning, rather than a responsibility label alone. Rubric weights and bounded arithmetic remain server-owned; no arbitrary overall score floor or cap was introduced. Missing evidence produces an honest absence, rather than an unsupported strength or fabricated quotation.

Maximum-score reports retain the model's narrative summary. Summaries cannot describe different answers as different candidates. Repeated coaching points are grouped, and prohibited filler/accent advice is removed from content coaching. Invalid model output has one bounded retry with validation guidance. The coaching revision is `answer-specific-v2`; generation and regeneration retain account ownership, deletion fences, attempt identity and retry quotas.

The two reviewed reports were refreshed through the normal protected regeneration handler, with backups retained privately. Both are COMPLETE and return through the session-detail API with HTTP 200:

| Interview start (IST) | Previous score | Refreshed score | Scoring scope |
| --- | --- | --- | --- |
| 17:00 introduction | 100 | 78.8 | Final introduction |
| 17:05 resume interview | 20.4 | 43.8 | Two substantive answers; one name correction excluded |

These remain rubric-based model assessments, not human-calibrated measurements. The resume answers still need specific explanations of implementation; excluding a name correction does not imply that every substantive answer merits a high score. Saved audio is unavailable for independent word-accuracy measurement.

## Validation and release

- Full backend suite: 76 suites, 580 tests passed. The final question-repeat follow-up additionally passed 32 focused regression tests.
- Targeted Flutter suite: 65 tests passed, covering profile/reset, locked premium browsing, score charts, large text at 320px, detail sheets, PDF export and AWS Transcribe behavior. Static analysis of all changed Dart source/tests passed.
- Visual render checks passed with the app font and icon font loaded. Device-specific behavior still needs testing on the user's phone.
- Backend rollout changes code packages only. Function settings, IAM declarations, endpoints, quotas and low-idle-cost hosting declarations are preserved. The main rollout verified all 61 functions; a follow-up updates only the input processor and async interview worker.
- Ten interviews per day per user remains unchanged. The audio server was verified stopped, with no public IPv4, after these tests.

APK: `output/Qlue-1.0.9-feedback-profile.apk`, version **1.0.9+10009**, 79,826,909 bytes.

SHA-256: `311bd681416d2dfd1685cad954c83b4a59db6b74caab80a47d05d88619b78fb6`.

Existing release signing certificate SHA-256: `cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd`. Signature and 16KiB zip alignment passed. AWS Transcribe and four-second automatic answer completion remain enabled. No Git commit, push or GitHub release was performed.

Private snapshots and deployment/repair verification are under ignored `tmp/session-review-20261021/`. They contain account data and must not be published.
