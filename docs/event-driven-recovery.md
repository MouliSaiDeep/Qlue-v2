# Event-driven background work

The six scheduled functions now process individual durable jobs. No recurring
EventBridge schedules remain in `backend/template.yaml`. Existing environment
values, runtime settings, and IAM policies are preserved; queue URLs and the
required stream/queue permissions are additive.

## Actual sources and recovery behavior

| Function | Event source | Delayed work |
| --- | --- | --- |
| AnalysisWorkerFunction | AnalysisJobsTable inserts and relevant status/lease changes | Run PENDING jobs; check RUNNING jobs after their lease expires. Existing direct job invocations remain supported. |
| DeletionWorkerFunction | DeletionJobsTable inserts or transitions to PENDING | Honor the existing 20-minute upload drain, then resume account checkpoints under an exclusive lease. |
| DispatchFeedbackJobsFunction | SessionsTable outbox and work-state changes | Dispatch PENDING feedback after its grace window; route turn, feedback-timeout, and audio-cleanup watchdogs. |
| RecoverFeedbackFunction | FeedbackTable notification state changes, plus targeted session watchdog messages | Deliver PENDING notifications, recover expired SENDING owners, mark timed-out feedback attempts FAILED, and clean up retained audio. |
| RecoverResumesFunction | ResumesTable inserts and parsing state/claim changes | Revisit PARSING records after three minutes; recover the matching parse attempt, at most three times. Stable records without claimedAt use updatedAt. |
| RecoverTurnsFunction | Shared RecoveryDelayQueue via dispatcher | Re-read a specific session, respect a live lease, and republish its stored job to AsyncInterviewQueue. |

All six workers share RecoveryDelayQueue. RecoveryDispatcherFunction is its
only consumer: it carries long deadlines forward, then asynchronously invokes
the allowlisted worker named in the envelope. The workers keep their own IAM
roles and failure destinations. This removes five idle queue consumers. The
original AsyncInterviewQueue retains exactly one consumer:
AsyncInterviewWorkerFunction. RecoverTurns republishes to it when necessary.

The feedback outbox is on SessionsTable, not FeedbackTable: report INSERT events
arrive after report generation, too late to recover a lost dispatch. Notification
delivery uses `notificationStatus`, not report `status`. Analysis/resume FAILED
records are terminal user-visible results, not automatic invitations to repeat
paid work. The handler compares old/new images and skips unchanged or completed
work; an explicit analysis reset to PENDING can start another attempt.

All five tables use NEW_AND_OLD_IMAGES. FeedbackTable's existing profile-update
consumer still receives NewImage and remains unchanged. SessionsTable has one
consumer routing its three watchdog categories, avoiding additional independent
readers of the same shards.

## Delivery and failures

- Stream batches contain at most ten records, start at TRIM_HORIZON, support
  partial failure responses, bisect on error, and have three retries and a
  one-hour maximum record age.
- Worker stream and async-invocation failures go to AnalysisWorkerDLQ,
  DeletionWorkerDLQ, ResumeRecoveryDLQ, or TurnRecoveryDLQ. Feedback workers
  reuse FeedbackDLQ. Async delivery has two retries and a one-hour event age.
- The shared queue uses partial batch acknowledgements and batch size ten.
  Its 180-second visibility exceeds six times the dispatcher's 30-second
  timeout. After five receives, undeliverable messages reach RecoveryDispatchDLQ.
  A successful forward requires Lambda's 202 acceptance. The worker then runs
  under durable Lambda async delivery with its own failure destination.
  All new queues retain messages for fourteen days and use SQS managed encryption.
- Timers carry only identifiers and attempt IDs. A handler consistently reads
  the current item before acting; it does not trust an old stream image as the
  current job state. Conditional writes, account fences, and owner/attempt
  checks protect against duplicate or stale deliveries.
- SQS delays are capped at fifteen minutes. Absolute deadlines survive bounded
  continuation messages, preserving the twenty-minute deletion drain and the
  legacy six-hour audio cleanup window without periodic table scans.
- A crashed worker does not need to write FAILED to trigger recovery: its
  earlier lease/state write already armed the delayed check. Terminal states
  stop recovery. Scheduled-event payloads no longer initiate a scan.

AWS still polls DynamoDB streams and SQS internally. This change removes idle
Lambda invocations and recurring recovery scans; it does not remove all AWS
stream/queue requests or guarantee a lower total bill at every traffic level.

SQS stream failure destinations contain failure metadata, not a full archived
copy of each DynamoDB record. Use the recorded stream/shard/sequence details
within DynamoDB's retention window, or reconcile the current durable job by key.
Do not feed these destination envelopes directly into a recovery queue as jobs.

## Deployment and existing work

The implementation was deployed and activated on October 18, 2026. The
[deployment report](deployment-2026-10-18.md) records the completed migration,
empty reconciliation inventory, enabled mappings and live queue checks. The
steps below remain the procedure for future updates requiring reconciliation.

These changes do not deploy themselves. Build/review the application and use the
existing owning stack. Do not deploy only the SAM event mappings with the old
scan-based handlers.

1. Pause admission/paid work for a controlled transition. Generate a paused
   migration with `node audit/prepare-paused-migration.cjs`; it now disables SQS
   and DynamoDB mappings as well as historical schedule types. Review/build it
   with the existing migration process. Changing FeedbackTable's stream view
   changes its stream descriptor; account for the existing profile consumer
   during the transition.
2. Deploy matching code, streams, queues, permissions, and disabled mappings.
   Inventory unfinished work once, including PENDING/RUNNING analyses,
   non-COMPLETE deletions, pending outboxes/feedback attempts, PARSING resumes,
   PENDING/expired-SENDING notifications, active turn jobs, and audio cleanup.
   Enabling a stream does **not** emit a snapshot of pre-existing rows.
3. Resolve RecoveryDelayQueue from the deployed CloudFormation resources. Seed
   one targeted SQS message per inventoried item using the envelopes below.
   Set `dueAt` to the current epoch milliseconds; handlers re-check actual drain,
   lease, grace, and attempt deadlines. Preserve the row's current attempt ID
   when present; omit it for legacy rows without one. Never change customer rows
   merely to manufacture stream events.
4. Enable the canonical mappings, check processing and DLQs, and restore the
   previous admission/stop-switch setting. Keep the pause shorter than stream
   retention, and reconcile work affected by the one-hour event age limit.
   Exercise one controlled job of each type, a duplicate/stale event, a retry,
   and a worker timeout. Confirm all six former scheduled rules are gone.

All messages below go to **RecoveryDelayQueue**. The `worker` field is required.

| Worker | Message body (`dueAt` is epoch milliseconds) |
| --- | --- |
| analysis | `{"version":1,"worker":"analysis","dueAt":1700000000000,"jobId":"job-id"}` |
| deletion | `{"version":1,"worker":"deletion","dueAt":1700000000000,"userId":"user-id"}` |
| dispatch | `{"version":1,"worker":"dispatch","dueAt":1700000000000,"sessionId":"session-id","attemptId":"current-attempt"}` |
| feedback | `{"version":1,"worker":"feedback","dueAt":1700000000000,"kind":"notification","feedbackId":"report-id"}` |
| feedback | `{"version":1,"worker":"feedback","dueAt":1700000000000,"kind":"feedbackTimeout","sessionId":"session-id","attemptId":"current-attempt"}` |
| feedback | `{"version":1,"worker":"feedback","dueAt":1700000000000,"kind":"audioCleanup","sessionId":"session-id"}` |
| resume | `{"version":1,"worker":"resume","dueAt":1700000000000,"resumeId":"resume-id","attemptId":"current-attempt"}` |
| turn | `{"version":1,"worker":"turn","dueAt":1700000000000,"sessionId":"session-id","jobId":"current-turn-job"}` |

## Local verification

From `backend`: `npm test -- --runInBand --no-cache`.

From the repository root:
`sam validate --lint --template-file backend/template.yaml --region us-east-1`.

Regression tests cover routing, expired/live leases, terminal/stale work,
notification retries, the deletion drain, partial batches, legacy resume records,
existing IAM/environment preservation, and the paused migration generator.
Synthetic AWS tests verify shared-queue routing, stream delivery, transactions,
async retries and destinations. Throttling under production load and migration
of existing work still require the controlled rollout checks above.

References:
[DynamoDB stream failures](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html),
[SQS delay limits](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html),
[SQS/Lambda configuration](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html),
[DynamoDB IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_dynamodb.html).
