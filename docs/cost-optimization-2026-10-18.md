# Backend cost optimization — 18 October 2026

These are local changes. The live `qlue-dev` stack has not been updated.

## Savings and safeguards

- Resume OCR uses Textract text detection. The former tables/forms analysis
  returned expensive structured blocks which the handler discarded; the AI
  parser consumes LINE text and retains its existing prompt and output schema.
- Official us-east-1 first-tier async prices are $0.050/page for forms plus
  $0.015/page for tables, versus $0.0015/page for text detection. That changes
  this OCR component from $65 to $1.50 per 1,000 pages, a 97.69% reduction before
  free tiers. It does not reduce the entire AWS bill by that percentage.
  See [AWS pricing](https://aws.amazon.com/textract/pricing/) and the
  [regional price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonTextract/current/us-east-1/index.json).
- Concurrent resume process requests atomically admit one attempt and store
  its immutable S3 version and recoverable worker request. Already processing
  or completed requests avoid both S3 reads and another worker invocation.
- Async deliveries must acquire a separate execution lease. Attempt and owner
  conditions fence stale commits. A stable Textract request token deduplicates
  OCR restarts for the same attempt after a lost response. Lambda hard timeouts
  remain recoverable through the existing delayed resume watchdog.
- Both resume and JD OCR validate actual object size and the PDF page tree
  before starting paid work: default limits are 10 MiB and 15 pages. Unversioned,
  invalid, encrypted, and oversized PDFs are rejected. OCR reads the exact
  validated version, including when a reusable PUT URL overwrites the key.
- Presign endpoints reject invalid declared sizes. PUT remains compatible with
  the released app; client declarations cannot bypass the post-upload OCR gate.
- Transient DynamoDB transaction conflicts receive bounded retries with jitter.
  Failed business conditions remain terminal; they never reopen an owned claim.
- One RecoveryDelayQueue replaces the unpublished six-queue recovery draft.
  A short dispatcher forwards due tasks to six allowlisted workers, keeping
  their isolated roles and async failure destinations. The interview queue
  retains its existing single consumer. Stream filters, current-state reads,
  bounded business retries and DLQs remain in place.
- The SAM provider-attempt default is 50/day, matching the existing development
  deployment override. It counts attempted calls, including failures, across
  providers. It is an attempt limit, not a guaranteed dollar spending cap.

The measured seven-day baseline had 50,400 scheduled invocations. Their Lambda
request/runtime component extrapolated to about $0.13/month before free tier;
the main saving comes from OCR and avoiding duplicate work. One queue removes
five idle consumers relative to the draft, but SQS, streams, dispatch invocations
and continuation messages still have costs. Actual totals depend on traffic,
provider/model usage and free-tier eligibility. See the prior assessment for
measurement boundaries; do not extrapolate its near-zero estimated bill forever.

## Verification and rollout

- Full backend suite: 430 tests in 62 suites, including PDF parsing, queue
  routing and admission fencing.
- SAM validation/lint, including all async destinations and scoped version reads.
- Fourteen real isolated AWS DynamoDB checks: ten concurrent API calls start one
  worker; ten duplicate execution claims yield one owner; stale commits fail;
  completed requests do not restart work. Budget, deletion, feedback, analysis
  and turn recovery regressions exercise real transactions too.
- Ten temporary AWS stream/queue/ARM64 checks pass: shared-queue forwarding,
  worker claims, SNS publication, legacy resume recovery, turn republication,
  stream DLQs and async invocation failure destinations. Provider and identity
  side effects are stubbed; this is not a real-document quality benchmark or a
  production load test.
- Source parity passes all 6,844 comparisons across 118 source files and 58
  function directories. Existing verified ARM64 dependency layers are unchanged;
  their package parity checks pass. Largest combined extracted package is
  193,700,144 bytes, below the project's 200 MiB bound, with no credential files
  or development packages found. This source refresh is not a fresh full
  container build; Docker was unavailable during this run.

Test evidence is under `tmp/cost-optimization-2026-10-18/` in this checkout.
The temporary AWS stack, artifact bucket, and transaction-test tables were
removed. No application data or live stack resources were changed during those
isolated validation runs. A subsequent authorized deployment on October 18
applied the event-driven implementation to the existing `qlue-dev` stack; see
the rollout report linked from the OTP verification document.
The transaction harness defaults to local DynamoDB; `node
audit/recovery-ddb-integration.cjs --aws-isolated` creates only new synthetic
tables and removes them afterward. It never selects existing application tables.

Use the [controlled migration procedure](event-driven-recovery.md) before live
rollout, including reconciliation of pre-existing work. Budget/email alerts
still need an OperatorEmail and subscription confirmation. Test representative
resumes during rollout to confirm text order and parsing quality on real inputs.
