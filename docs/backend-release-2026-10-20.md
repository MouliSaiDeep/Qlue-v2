# Feedback and per-user quota backend release

Deployed October 20, 2026. Access restored at **17:20 IST / 11:50 UTC**.
Stacks `qlue-dev` and `qlue-audio-gateway` are `UPDATE_COMPLETE`.
The operational processing switch is restored to `none`; audio admission is
enabled. No Git commit or GitHub push was made. No frontend source, application
version or APK was changed for this release.

## Released behavior

- Structured, accepted question/answer pairs, anchored module-specific rubrics,
  exact evidence validation and server-calculated weighted scores.
- INTRO grades the final introduction and records practice progress separately.
  Confidence inferred from text is excluded. Unusable assessment input/output
  produces unavailable feedback rather than an invented fallback mark.
- One judging call plus deterministic report formatting, with one bounded model
  retry. Stored reports, session history and dashboard use the canonical score.
- Authoritative ASR evidence survives async processing; public JSON cannot forge
  it. Extremely uncertain recognized spans are masked only in grading input.
- **Ten interview sessions per user per UTC day**, independent across users.
  Reset remains 05:30 IST. Existing daily session counters were preserved.
- Provider retry/loop guard: 500 requests per user per UTC day. Questions and
  feedback calls do not count as extra interview sessions. Unowned system/test
  calls retain their separate existing 50-attempt guard.
- The audio gateway's shared 20-start daily test limit is removed. Each user now
  has a separate **160 answer-capture starts/day** guard, including retries
  (ten interviews × eight answers × two starts). These are captures, not 160
  interviews. Account deletion includes the user-owned counter rows.
- Four simultaneous audio streams remain the shared capacity limit. This is
  physical service capacity, not a pooled daily interview allowance.

## Rollout and preservation

The exact deployed application template, function configuration and four
original code/layer artifacts were saved before release. Candidate source was
compared with the deployed package: only the 17 intended feedback, quota,
ASR-evidence and dashboard source files differed.

CloudFormation updated all 61 function packages and added the two quota
environment variables. All prior environment values, role ARNs, layer ARNs,
runtime, handlers, memory and timeout settings were verified unchanged.
Existing tables, buckets, queues and API addresses were preserved. The
application change set also reported unchanged reference dependencies; their
declarations and stable physical targets were reviewed before execution.

The gateway used the exact previous infrastructure template with only its image
and daily-stream parameter updated. Its reviewed change set contained only the
ECS task definition and service. No new always-on service or larger task was
added. IAM/network configuration was not expanded. Paid AI and audio admission
were temporarily paused while requests drained and both stacks updated.

The deployed source package contains 124 files, 253,212 compressed bytes.
Lambda CodeSha256:

`j38HWWpkpWkrGcKLpB2Ck6tTUsrA9iUjmsidDz5hoFQ=`

Gateway image digest:

`sha256:194bf62868b50d23708a970db58b855a02d5bf81ac166d63ac78824944435d36`

The ARM64 image manifest scan completed with no findings. The image remains
non-root with a read-only root filesystem and dropped capabilities.

## Verification

- Backend: **72 suites / 540 tests passed**.
- Gateway: **23 tests passed**, including independent daily user counters and
  atomic concurrent admission.
- ARM64 container startup, health, disabled-audio rejection and graceful exit
  passed with the restricted container settings.
- Isolated AWS validation passed nine checks, including real DynamoDB stream
  admission, per-user isolation, deletion fencing and final transcript evidence.
  The three temporary tables were removed after testing.
- All **61 Lambda functions** have the expected new code hash and are Active
  with Successful updates. All **eight event source mappings** remain enabled.
- The new gateway has one stable running task; public health responds normally.
- A real SNS event for an authenticated synthetic account traversed trigger →
  Bedrock analysis → formatter → storage. Rubric v2 completed with one model
  attempt and the expected final-introduction scope. The system/test budget
  counter did not change. The public Firebase-authenticated report API returned
  the canonical weighted score.
- The deployed usage Lambda returned a separate ten-interview allowance. An
  initial HTTP usage probe returned 403 because this existing handler has no
  public API route; the probe was corrected to invoke that Lambda directly.
  The public report API itself passed. No new HTTP route was added.
- A verified synthetic identity streamed synthetic PCM through public WSS,
  CloudFront, the private origin and Transcribe. Final evidence persisted and
  passed the backend ownership contract; the technical vocabulary was applied.
- Both live checks removed their synthetic Firebase identities and owned data.
  No real candidate answers were regraded, and no human notifications were sent.
- All four interview UI files still match stable tag `v1.0.9`, normalized for
  line endings. Git HEAD remains
  `7b9d6f5f16deecb967d3d8224c480a3e15ca32ef`.

These are deployment and engineering checks, not human-rater calibration or
phone microphone acceptance. Reports retain `NOT_HUMAN_CALIBRATED` metadata.
The existing AWS-transcription APK can use this deployment without a new build.

## Evidence and rollback

Evidence is under `tmp/backend-release-20261020/`: `backend-tests.log`,
`gateway-tests-final.log`, `staging-check.json`, `image-scan.json`,
`verification.json`, `activation.json`, `feedback-smoke.json`, `live-smoke.json`
and `final-verification.json`.

`private/` contains exact pre-release templates, function configurations and
artifacts. Configuration snapshots can contain secrets; do not publish them.
`rollback.cjs start` restores the pre-release application package/environment
and gateway image/parameter through their owning CloudFormation stacks, with
admission paused. After both stacks are stable, verify baseline hashes and use
`rollback.cjs restore-access`. No rollback was executed. Rollback never resets
customer daily counters or deletes customer data.

## Subsequent repair

The later [feedback/layout repair](feedback-layout-repair-2026-10-20.md)
updated only the analysis Lambda package. The common code hash and smoke
results above describe the preceding deployment, not the later analysis code.
