# Operations and cost measurements

## Measurements added

The audio gateway emits allowlisted CloudWatch Embedded Metric Format documents
under `Qlue/Audio`, dimension `Service=audio-gateway`:

| Metric | Meaning |
|---|---|
| StreamEnded | A transport attachment reached its terminal path |
| StreamCompleted | An authenticated stream persisted FINISHED evidence |
| StreamInterrupted | An authenticated stream did not complete normally |
| StreamRejected | An attachment ended before authentication |
| EvidencePersistenceFailed | Recognition evidence could not be saved |
| AudioSeconds | Received PCM bytes divided by 32,000 |
| StreamDurationMs / FirstPartialMs | Observed application durations; absent observations are omitted |

The backend emits `Qlue/Application`, dimension `Operation=Model` or `Feedback`:
`ProviderAttempt`, `ProviderSuccess`, `ProviderFailure`, `ProviderLatencyMs`,
`InputTokens`, `OutputTokens`, `FeedbackStored` and `FeedbackUnavailable`.
Provider attempts are counted after quota/stop admission, before the actual SDK
call. Available SDK token usage is recorded, including streaming metadata.
Feedback storage skips known duplicate deliveries.

Documents exclude user/session IDs, URLs, credentials, prompts, transcripts and
audio. The allowlists discard unexpected fields and non-finite observations.
Telemetry failures cannot cause another paid model request or hide saved feedback.
Metrics are best-effort observations, not an exact-once billing ledger. Multiple
deployments using these namespaces in the same account/region aggregate together.

## Operator checks

Verify the log sink extracts EMF in the intended region. Start with charts for
completion/interruption/rejection counts, evidence persistence failures, provider
failures versus attempts, latency p50/p95 and feedback unavailable outcomes.
Compare counts with owned synthetic probes; distinguish a lack of traffic from
a failed pipeline. Define thresholds after observing baseline traffic.

The application template already includes error/throttle, API latency and queue
alarms. Set a real `OperatorEmail`, confirm its SNS subscription and trigger a
controlled alert to prove delivery. An empty email parameter does not provide
an operator response path. Check dead-letter queues and oldest-message age.

Measure interview completion using accepted session outcomes, including
`feedbackExpected` and `terminationReason`; do not treat every cancellation as a
service failure. Investigate stuck sessions and feedback as well as Lambda Errors.

## Cost per useful outcome

Record provider input/output tokens, Transcribe audio duration, Polly characters,
OCR pages, retries and completed interviews. Join detailed records only in
authorized private reporting; never add per-user dimensions to public metrics.
Compare daily/weekly cost per completed interview and feedback report with an
itemized AWS bill after billing delay. Attempt caps are not dollar caps.

Retain the operational stop switch, per-user interview/provider/audio safeguards
and monthly budget alerts. Set a target margin using actual usage; credits and
free tiers are temporary offsets. Validate current regional prices before
changing capacity. Public Fargate baseline costs differ from the stopped-host
estimate in dated documents.

No telemetry has been verified in CloudWatch by this local change; that requires
deployment and a controlled acceptance run. Local metric tests verify shape,
privacy and failure isolation.
