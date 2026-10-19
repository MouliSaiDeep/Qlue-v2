# Backend reliability and cost assessment — 17 October 2026

The event-driven recovery paths passed isolated AWS integration tests. The
current application backend has not been redeployed: `qlue-dev` still runs the
six scheduled workers from its 11 October deployment. The assessment created
and removed a separate synthetic stack; customer records, production schedules,
and production configuration were not changed.

## Verification and fixes

- Full host suite: **403 tests / 60 suites passed**, with all-source coverage.
- Linux ARM64: the same **403 distinct tests passed** across the main run and
  focused reruns, including the three subsequently added entrypoint cases. The
  initial 400-case run had three harness failures: two fixture outputs targeted
  the read-only checkout, and the offline Firebase subprocess hit its 20-second
  guard under QEMU. Fixture evidence now goes to a temporary directory. Firebase
  passed with a 120-second emulation allowance; its standard host limit remains
  20 seconds. These runs establish functionality, not production latency.
- Real DynamoDB Local: **11 integration checks passed**, covering concurrent
  analysis claims, exhausted leases, the restored analysis handler exports,
  deletion ownership/checkpoints/retry, feedback dispatch and delivery, attempt
  isolation, resume recovery, turn republication, and an atomic provider budget.
  Ten concurrent budget requests admitted exactly three against a limit of
  three; paused and zero-limit requests were rejected.
- Real AWS: **9 checks passed** against temporary tables, streams, queues, an
  ARM64 Node 24 Lambda, a scoped test IAM role, and an SNS sink. All six worker
  paths delivered, and a poison stream record exhausted retries into its DLQ.
  Paid model/OCR, Firebase delivery, and destructive account-provider effects
  were stubbed. This establishes transport/transaction behavior, not a new
  end-to-end acceptance of the public app or paid provider output quality.
- A fresh SAM Docker build of the ARM64 dependency/native layers succeeded.
  Latest plain JavaScript sources were synchronized after the fixes. All
  **6,669 file comparisons across 57 function artifacts** matched source.
  Production layer parity covered **289 application packages and 17 native
  runtime packages**, with zero drift.
- Largest function plus attached layers: approximately **193.7 MB extracted**,
  below the project's 200 MiB safety limit. No development packages or credential
  files were detected in the packages.
- Packaged Linux ARM64 PDF parser: valid, oversized, and malformed PDF cases
  passed. Packaged ONNX runtime loaded the pinned model and passed actual native
  inference on synthetic silence.
- Root, application-layer, and delivery-layer production audits each reported
  **zero vulnerabilities**. Canonical SAM lint passed.

The assessment found and fixed problems that the original mocked worker tests
did not catch:

1. Analysis recovery called missing 429/503 response helpers, preventing clean
   terminal failure. The helpers are now exported and regression-tested.
2. Durable analysis jobs expected `.processAnalysis`, while restored JD/website
   implementations export `.handler`. Dispatch now supports the real exports.
3. A legacy PARSING resume without timestamps could keep postponing its own
   recovery. Missing timestamps now produce a due check rather than a moving
   deadline.
4. A feedback attempt replaced between two consistent reads could be dispatched
   by an old watchdog. The second read now checks the attempt identity too.
5. OCR starts bypassed the global provider-attempt guard. Resume/JD OCR starts
   now use the stop switch and attempt budget, with automatic SDK start retries
   disabled so application attempts are counted. Resume worker deadlines retain
   the user/action context through the paid-call guards.
6. Two retained utility Lambda resources lacked their declared `.handler`
   exports. Adapters now preserve the deprecated state no-op and the existing
   error utility. All 57 SAM entrypoints are checked automatically.

All-source host coverage is **48.09% statements, 42.12% branches, and 43.02%
functions**. A passing suite is not a claim that every legacy handler or every
possible production failure has been covered.

## Current measured usage and cost

CloudWatch window: **10 October 2026 00:00 UTC through 17 October 2026 00:00 UTC**
(exclusive end). These are the existing scheduled workers, not the new design.

| Scheduled worker | Seven-day invocations | Mean duration | Memory |
| --- | ---: | ---: | ---: |
| AnalysisWorkerFunction | 10,080 | 20.27 ms | 512 MB |
| DeletionWorkerFunction | 10,080 | 20.94 ms | 512 MB |
| DispatchFeedbackJobsFunction | 5,040 | 105.20 ms | 256 MB |
| RecoverFeedbackFunction | 10,080 | 132.00 ms | 512 MB |
| RecoverResumesFunction | 5,040 | 376.89 ms | 128 MB |
| RecoverTurnsFunction | 10,080 | 53.72 ms | 512 MB |

Total: **50,400 invocations, zero reported Lambda Errors, zero throttles, and
1,513.76 GB-seconds**. Lambda error metrics do not expose business errors that a
handler catches and returns as success.

At the same rate for 30 days, using current us-east-1 ARM prices:

- Requests: 216,000 × $0.20/million = **$0.0432**.
- Observed execution duration: 6,487.56 GB-seconds × $0.0000133334 = **$0.0865**.
- Those measured Lambda components total approximately **$0.13/month before
  free tier or credits**. Initialization/billing rounding and logs are not
  included, so this is an estimate rather than an invoice reconstruction.
- The five base tables consumed 532,365 read units in seven days. Extrapolating
  all of those reads gives approximately **$0.29/month**. This includes reads
  outside recovery and excludes GSI reads, so it is not an attributed scan-cost
  saving.

The six new SQS consumers have an idle-request cost too. As an illustration,
two pollers per queue making a 20-second empty receive would produce 1,555,200
requests in 30 days, or **$0.62 before free tier**, before sends/deletes and work
processing. Actual poll behavior is adaptive; this is not a measured new bill or
a guaranteed minimum. Free-tier benefits are shared with other account usage.

Cost Explorer reported effectively zero estimated account-wide service charges
for the same seven days; all seven daily results were marked estimated. This
does not establish a future marginal cost or attributable savings for this app.

**Cost conclusion:** eliminating scans is useful as retained data grows, but
the current scheduled Lambda workload is already inexpensive. This six-queue
design has not demonstrated net savings at today's traffic and can cost more
while idle. It should not be presented as a major bill-reduction change.

Official rate evidence:
[Lambda us-east-1 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json),
[DynamoDB us-east-1 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/us-east-1/index.json),
[SQS us-east-1 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/us-east-1/index.json).
See also [SQS request billing](https://aws.amazon.com/sqs/pricing/) and
[Lambda SQS polling](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html).

## Remaining boundaries

- The live stop/cap configuration still has **50 provider attempts/day** and a
  $50 monthly budget parameter. This is an attempt limit, not a dollar limit;
  token/page counts and provider rates affect actual spend. OperatorEmail is
  empty, so the conditional budget/email notification is not configured.
- The restored resume admission path still permits repeated process requests
  to enqueue duplicate OCR work: two synthetic requests produced two worker
  invocations in the database-backed probe. Its active flow does not call the existing
  server-side PDF page validator. The new provider guard bounds attempt count,
  but these remain cost-hardening gaps for unrestricted public use.
- The isolated AWS worker uses provider stubs. New real Bedrock/Textract/FCM,
  authenticated public API, load, and phone acceptance were not established by
  these smoke tests.
- Enabling streams does not replay old table contents. Production rollout must
  reconcile existing unfinished rows once, as described in
  [the migration guide](event-driven-recovery.md).

**Reliability conclusion:** the event-driven recovery implementation has
substantial passing local and real AWS evidence. The entire backend should not
be described as perfect or fully hardened for unrestricted use. A production
transition and the remaining ingestion/cost controls require separate work.

Detailed local evidence is retained under
`tmp/backend-assessment-2026-10-17/`, including the test logs, coverage, package
checks, AWS smoke results/cleanup, measured usage, official rates, and cost
calculation inputs. The production deployment was not changed.
