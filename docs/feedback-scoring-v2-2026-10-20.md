# Backend feedback rubric v2 — implementation and verification

Current status: **deployed October 20, 2026**; see
[the release and live verification record](backend-release-2026-10-20.md).
The implementation/checkpoint notes below precede deployment. No frontend files,
application version, APK, IAM policy, environment variable, resource definition,
Git commit or remote branch was changed for this task. Earlier uncommitted
speech/UI work remains in the checkout.

Subsequent user requirement: ten interviews per user per day, not a shared
allowance. The released quota correction is documented in
[the interview quota policy](interview-quota-policy.md). It separates user
provider counters from the exhausted system/test counter. The source archive,
comparison and test counts below describe the feedback-only checkpoint before
that follow-up; a future deployment must rebuild and verify the combined source.

## Behavior

- Accepted answer IDs are paired with their actual questions. The server reads
  owned session context for role- and source-dependent modules. Candidate text
  is untrusted data, including instructions embedded inside an answer.
- Four module-specific criteria use explicit 0–4 anchors and server-owned
  weights. The model supplies per-answer levels and exact evidence excerpts;
  application code validates them and computes the weighted result.
- INTRO grades the final introduction. Baseline-to-final progress is separate.
  An unusable ASR baseline does not invalidate a usable final introduction and
  does not produce an invented progress comparison. Other modules aggregate
  the accepted answers.
- Confidence is excluded from the content grade. ASR recognition confidence
  is not a measure of a person's speaking confidence or emotional state.
- Extremely uncertain recognized words are masked in grading input using
  authoritative character offsets. Original transcripts remain unchanged.
  Ambiguous alignment or missing essential input/context withholds a grade.
  This cannot identify background words recognized with high confidence.
- Authoritative ASR evidence survives the async worker and permanent transcript
  write. Public JSON cannot forge this evidence: the in-process handoff uses
  a Symbol that cannot be serialized into an API request.
- One judging call produces levels and evidence. The report formatter derives
  matching coaching from those results without a second model call. Invalid
  output permits one bounded retry, never an invented 50-point fallback.
- The report formatter recomputes scores. Dashboard/history APIs carry the
  canonical weighted overall score while the stored report retains dimensions.
  Unavailable final assessments clear provisional scores and return the existing
  frontend error path instead of rendering an invented zero score.

The unchanged frontend can display these report fields and criteria. Its
existing error path can retry/poll before showing a generic failure; a more
specific unavailable message would require a separate frontend logic change.
Historical reports are not automatically regraded.

## Rubrics

| Module | Criteria and weights |
| --- | --- |
| INTRO / SELF_INTRO | Relevance 30; Specific Evidence 30; Structure 25; Clarity 15 |
| RESUME | Technical Accuracy 40; Relevance 20; Specific Evidence 25; Clarity 15 |
| JD | Role Alignment 35; Technical Accuracy 30; Specific Evidence 20; Clarity 15 |
| HR | Relevance 30; Specific Evidence 30; Reasoning & Reflection 25; Clarity 15 |
| WEBSITE | Comprehension 40; Application 25; Reasoning 20; Clarity 15 |

The prompt asks for short quotes; validation permits exact excerpts up to 500
characters to avoid another paid call solely for a slightly longer sentence.
Quotes from questions, fabricated text and uncertain-audio placeholders are
rejected. Level zero is valid when actually assessed; unavailable is a separate
state with no numerical mark.

Schemas are stable across candidate IDs to permit reuse of Bedrock's compiled
grammar. Application validation still enforces cardinality, bounds, identity and
grounding. AWS documents unsupported schema constraints such as maxLength in
[its structured output guide](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).

## Verification

- Full backend suite: **71 suites, 526 tests passed**. Log:
  `tmp/feedback-v2-final-tests.log`.
- Integration tests cover accepted-answer selection, attempt fencing, final
  INTRO scoring, deterministic report generation and canonical persistence.
- Failure cases cover malformed levels/JSON, fabricated or foreign evidence,
  stale attempts, incomplete input, recognition uncertainty, unavailable
  assessments, forged public ASR metadata and bounded retries.
- Live synthetic checks used the configured model,
  `nvidia.nemotron-super-3-120b`, with the existing operational guards. An earlier
  complete 11-case run covered all five modules, discrimination of strong/vague
  and correct/incorrect answers, repeatability, uncertain trailing noise and
  prompt injection. Subsequent review identified an unasked-example penalty and
  blanket grading; the prompt and evidence criterion were refined accordingly.
- The refined prompt produced strong 100, vague 21.3, repeat 100, noisy strong
  100 and injection 0 in captured synthetic responses. These are fixture
  observations, not accuracy measurements or a validated grading scale.
- **The final cross-module live checks remain incomplete.** Verification reached
  the existing shared global budget: `PAID_ATTEMPT_LIMIT=50`, daily attempts=50.
  The limit was not raised or bypassed. It blocks paid AI requests, including
  normal app usage, until the next UTC-day budget key becomes available. Local
  tests do not consume that allowance.
- The final source archive was compared with all 11 affected live Lambda
  packages. Only the 13 intended feedback/ASR/dashboard source paths differ.
  No unrelated source differences were bundled. Archive:
  `tmp/feedback-v2-20261020/feedback-v2.zip` (252,478 bytes), SHA-256/base64:
  `182i8DRojUcyz2104q+yHirdZmCOhrisja1KggPoIu4=`.
- Read-only verification confirmed code hashes, environment variables, IAM
  roles and layers for all 11 live functions remain unchanged. Exact rollback
  ZIPs/configuration are in the ignored private snapshot directory; do not
  publish these configuration files because they can contain secrets.
- The interview screen still matches tag `v1.0.9` after newline normalization.
  Git HEAD remains `7b9d6f5f16deecb967d3d8224c480a3e15ca32ef`.

## Completion gate

When the daily budget permits, rerun the synthetic model checks against the
final source. Confirm that clear correct definitions are not penalized for
unasked personal examples, and that technical correctness and clarity are
graded independently. Do not bypass the operational cost guard to do this.
Refresh snapshots before a later code-only deployment, preserve all function
configuration, deploy consumers before the trigger, and verify code hashes and
the report pipeline afterward. No deployment commands were run in this task.

Human-rated calibration is still required. Results explicitly record
`NOT_HUMAN_CALIBRATED`; automated engineering checks do not establish scoring
accuracy, population fairness or a defensible numerical quality rating.

One judging call and deterministic formatting reduce model-call overhead,
but actual cost depends on input/output tokens, retry rate and the active
model. No new paid service or resource was added.
