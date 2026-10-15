# Controlled Qlue backend and APK rollout

## Current fresh-stack baseline

The retained-stack migration sequence below is historical. The user subsequently authorized a fresh stack and deletion of existing Qlue AWS application data. The replacement `qlue-dev` is deployed; see [deployment verification](backend-deployment-verification-2026-10-04.md) for executed work, final checks, and remaining holds.

For subsequent authorized updates, run `sam build` and `sam deploy` from `backend`. Default build settings use a Linux container; inspect the generated change set before execution. Keep the artifact size/credential gate and packaged runtime checks. Activation was explicitly approved and completed on 4 October: processing is enabled with a verified 50-attempt daily provider cap. The deployed experimental ESM setting has an AWS support/SLA limitation documented in the verification report.

## Historical retained-stack preparation

Prepared locally on 4 October 2026. No migration, paid cloud exercise, notification, data reconciliation, or APK publication was executed. Main pushes run verification only; a manual backend workflow produces a paused review artifact without AWS credentials. Version tags build a signed APK artifact after unit/static/backend/native speech gates; publication is deliberately absent until the migration and device acceptance are recorded.

The owning stack is `qlue-dev`, `us-east-1`. The `prod` samconfig entry names a different stack (`qlue-season8-prod`); fixed-name tables/buckets/queues cannot be installed over the owning stack by changing this label. Preserve existing parameters, data resources and Firebase environment. Use a separately authorized account/region for isolated staging. Refresh the read-only inventory and deployed Processed template before each operator phase; prepared artifacts are snapshots, not proof of live readiness.

## Prepared local artifacts

From the repository root:

```powershell
node audit/prepare-paused-migration.cjs
node audit/prepare-log-adoption.cjs audit/remaining-fixes-evidence-2026-10-03/private-migration/deployed-processed.json audit/remaining-fixes-evidence-2026-10-03/live-summary.json audit/remaining-fixes-evidence-2026-10-03/private-migration
node audit/prepare-feedback-index.cjs audit/remaining-fixes-evidence-2026-10-03/private-migration/import-template.json audit/remaining-fixes-evidence-2026-10-03/private-migration/index-only.json
```

The gitignored private folder contains the exact read-only Processed baseline, `import-template.json`, `resources-to-import.json` and `index-only.json`. Keep this configuration private. The last command demonstrates the intended baseline after import; after actual import, export its current Processed template again and regenerate the index-only file. Do not package/import the new SAM application as part of log adoption.

`backend/template-migration.yaml` is reproducibly generated from the canonical template, retaining CloudFormation intrinsics and CodeUri paths. Its only intentional changes are `PaidOpsSwitch.Value = all` and every discovered schedule disabled. Currently six schedules are found: feedback dispatch, deletion, turns, feedback recovery, analysis, and resume recovery. The generator also handles new ScheduleV2/EventBridge rules. The canonical template enables processing and must not be used for the first application rollout.

## Operator sequence and hold points

1. **Drain and maintenance.** Stop old REST/WebSocket admissions, event-source workers and old invocations through an authorized maintenance plan. The September 26 deployment has no runtime stop switch; creating SSM alone cannot stop that version. Allow at least 20 minutes from the final legacy 900-second upload policy/worker admission and confirm no old active work remains. Preserve queued/DLQ work for reconciliation. Record last admission and drain evidence; keep maintenance until new IAM, indexes and workers are ready.
2. **Log IMPORT only.** Preserve all baseline parameters using UsePreviousValue. Review a CloudFormation IMPORT change set containing exactly the 33 existing log groups with Retain policies, and no other resource updates/removals. Import mirrors their current retention; the later application UPDATE applies 30 days. For templates over the inline limit, use an approved artifact-bucket template URL. Check owning stack and physical log names, then obtain authorization to execute the reviewed import. Wait for IMPORT_COMPLETE and review drift. [AWS import requirements](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/import-resources-manually.html).
3. **Index-only UPDATE.** Regenerate against the exact adopted Processed baseline. Review `index-only.json`: one `FeedbackDispatchIndex` addition on `qlue-sessions` (HASH `feedbackDispatchPending:S`, RANGE `feedbackJobUpdatedAt:N`, ALL projection). Preserve UserActiveIndex and GSI_UserIdStartedAt and all unrelated resources. Execute only after separate authorization and wait for the new index to be ACTIVE before dispatch is permitted. It belongs on sessions, not feedback. [AWS index readiness](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.OnlineOps.html).
4. **Paused application/infrastructure UPDATE.** Build the generated migration with actual Linux arm64 dependencies. Review additive DeletionJobsTable/AnalysisJobsTable, durability/PITR/TTL/deletion protection, table-scoped IAM and indexes, S3 object-version list/read/copy/tag/delete rights, SQS/SNS/Lambda/SES/FCM paths, and adopted log retention. Reject unplanned replacements, ARN drift, data removal or fence resets. Confirm all six generated EventBridge rules are DISABLED and paid switch is all. Maintain admission/drain controls while old code is replaced; do not assume the newly introduced switch protects old workers during the update.
5. **Configuration and cost controls.** Choose real OperatorEmail, MonthlyBudgetUsd and PaidAttemptDailyLimit; confirm SNS subscription. Verify SUPPORT_EMAIL/SES identity and region, Firebase/FCM secret bindings, Bedrock and Polly permissions, audio refresh and S3 policies. `/qlue/qlue-dev/paid-ops-disabled` accepts `all`, `none` or supported comma-separated action names. Lambdas cache it for 15 seconds and fail closed if it cannot be read. Verify actual propagation before reopening. Budget alerts are notifications; attempt counters and the switch bound application work. The SSM parameter value is mutable operational state: read it after each stack update, because a template default change can reset it.
6. **Legacy reconciliation with schedules paused.** Inventory owned unfinished UPLOADING/PARSING rows against immutable object versions and valid retry paths; never invent PARSED success or release a deletion fence. Preserve parsed resumes. Inventory legacy interview receipts/history, pending answers and INTRO attempts; preserve successful transcripts and restart ambiguous sessions visibly. Review PENDING feedback without durable attempt/outbox identity, preserve completed reports, mark unrecoverable jobs FAILED with explicit regeneration. Do not send unsolicited historic notifications. Review deletion checkpoints, analysis jobs, DLQs and late writers. Each customer-row change requires authorization and an idempotent, bounded plan; no reconciliation script was run here.
7. **Controlled cloud acceptance.** In isolated staging with controlled identities and explicit spend caps, test protocol-2 exact-size/60-second POST limits and expiry; immutable version processing; real IAM; duplicate delivery/crash/DLQ handling; owned audio refresh; one answer commit through reconnect/GSI lag; bounded exhaustion; deletion checkpoints/versions/restore fences; auth expiry/revocation; SES/FCM delivery; and stop-switch propagation. Record actual service evidence, not unit-test substitutes. Run physical Android acceptance below against this compatible backend.
8. **Enable processing, then publish APK.** Only after index ACTIVE, IAM, configuration, reconciliation, cloud tests and hardware acceptance have signed-off evidence, review a separate canonical-template update enabling the six schedules and setting the paid switch default to none. Reopening paid operations needs explicit authorization. Recheck actual switch/rule state, open controlled traffic and monitor acceptance before reopening publicly. Publish the matching signed APK only after the compatible backend is accepting protocol-2 traffic. CI currently has no automatic deploy/publication step to bypass these hold points.

## Build and review commands

Run locally from `backend` after a responsive Linux Docker engine is available:

```powershell
node ../audit/prepare-paused-migration.cjs
sam validate --lint --template-file template-migration.yaml
sam build --use-container --no-cached --template-file template-migration.yaml
node ../audit/verify-packaged.cjs
npm test -- --runInBand --resolver=./tests/helpers/layerResolver.cjs
```

Run the native parser from repository root:

```powershell
docker run --rm --platform linux/arm64 --entrypoint node -v "${PWD}:/workspace:ro" -w /workspace public.ecr.aws/lambda/nodejs:24 audit/layer-smoke.cjs
```

After log import/index readiness and operator configuration decisions, the normal SAM flow prepares the application change set with the built paused template, from `backend`:

```powershell
sam deploy --template-file .aws-sam/build/template.yaml --stack-name qlue-dev --region us-east-1 --capabilities CAPABILITY_IAM --no-execute-changeset --confirm-changeset --no-disable-rollback --parameter-overrides OperatorEmail=<confirmed-email> PaidAttemptDailyLimit=<reviewed-cap> MonthlyBudgetUsd=<reviewed-budget>
```

Replace placeholders and preserve other existing parameters through reviewed configuration. Packaging/change-set preparation writes AWS artifacts and needs separate authorization. Inspect the named change set and obtain execution authorization separately; no command above was used to deploy. SAM's no-execute option creates the change set without applying it, and rollback remains enabled. [AWS SAM options](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html).

## Rollback and acceptance evidence

Before every phase, record stack ID/resources, parameter references, current template/code artifacts, version bindings, queues/DLQs, table PITR state, rule states and switch state. Require zero unintended replacements/deletes. Log import/index addition are additive; keep imported logs/index/durable tables on an application rollback. Do not roll back to September 26 handlers while reopening the protocol-2 APK: keep maintenance and paid switch all, pause schedules, and restore a compatible tested application artifact. A public APK rollback requires a newly signed build with a higher versionCode; Android will not downgrade an installed release.

On failure, close admissions, set all on the runtime switch for the compatible deployment, wait for propagation, pause recovery triggers and drain exact owned work. Restore the reviewed previous application without removing durable data/resources; investigate writes under maintenance. Do not use blanket deletion, queue purges or resurrect deleted accounts. After success, verify actual code hashes/configuration, six schedule states, GSI ACTIVE, bounded uploads, durable jobs, logs retained, correct identity ownership, alerts and selected controlled endpoint/worker transactions. Cloud/device measurements and rollout approval remain required.

## Physical Android acceptance checklist (pending)

Use Android API 24+ physical devices and controlled accounts, including a representative low-memory handset. Run every supported module: resume, JD, website, technical/HR, and introduction flows as available in the app. Record device/API, APK hash, backend version, scenario, latency and results.

- Quiet/noisy speech, 2–3 second pauses, short/repeated phrases, Indian English and target accents, technical vocabulary, speaker/headset leakage. Measure acoustic speech-end to native speech boundary, quiet endpoint, final transcription, submission and next audio separately. More than five seconds of valid quiet after speech must submit once; missing/interrupted service/audio must never substitute for silence. Test native recognizer boundary stalls and watchdog behavior on device; recorded local-model probes do not prove this default behavior.
- Reconnect during question playback, finalization and submission. Retain answer and clientTurnId; bounded recovery; optional Replay; no required buttons for normal answer/recovery. Exhaust retries and verify explicit recoverable/terminal state and no duplicate mutation.
- Permission denial/revocation, audio focus loss, phone interruption, background/foreground, deliberate lock, route exit, account A→B and A→logout→A; no old callback or HTTP body enters a new login/question. Ending always releases capture/models/playback and restores normal sleep.
- Screen stays awake only during an active foreground interview; test beyond the configured screen timeout, reconnect/replay and End. Verify sleep restores outside the interview.
- Long answers on the chosen system recognizer across multiple recognition cycles, transcript retention and the backend text limit; record actual service duration/availability limits and recovery latency. The user intentionally retained system recognition: the experimental local engine alone has a 180-second retained-PCM cap, with retained-draft interruption at that cap. Do not claim that limit applies to default capture. If evaluating the experimental path, separately measure its cap, native model startup/failure, cold/warm latency, CPU, RAM, thermals and battery. Measure system-service startup, memory, CPU and battery for the shipped default too.
- Install the actual published APK on a controlled device, then `adb install -r frontend/build/app/outputs/flutter-apk/app-release.apk`. Preserve data/sign-in, verify package/versionCode/certificate continuity and correct Firebase/API binding. Do not uninstall to hide an upgrade failure. No physical-device run has been performed here.
