# Backend improvement plan with the frontend frozen

Planning baseline: 22 October 2026. This document is a proposed execution plan,
not evidence that its checks have passed. No deployment or application change
is performed by writing it.

## Scope and compatibility

- Freeze `frontend/`, its build configuration, dependencies and signed APK.
  Preserve the current screens, navigation, styling, text and interaction flows.
- Work in backend handlers/libraries, the audio gateway, infrastructure, backend
  tests, CI and operational documentation.
- Preserve API paths, required response fields, types, score ranges, WebSocket
  messages, authentication and error codes understood by the existing APK.
- Snapshot frontend input hashes and API examples before work. Check the hashes
  after each phase. Capture no credentials or private user content in evidence.
- Backend refactoring should follow demonstrated problems. Do not rewrite the
  interview architecture merely to reduce file length.
- If testing finds a defect requiring frontend code, record it separately. A
  frontend freeze limits what server-side work can solve; do not claim otherwise.

## 1. Establish a reproducible baseline

1. Inventory existing edits and new production files. Separate intended source
   from private investigation material; avoid bulk staging.
2. Record source revision/fingerprint, APK digest, deployed backend versions,
   gateway routing, provider quotas and current CONTROL settings. Read current
   state without modifying it; historical records are insufficient.
3. Run backend tests with coverage, gateway tests, synthetic load checks and
   production dependency audits. Run existing Flutter checks without editing it.
4. Build the deployable backend and Linux ARM64 gateway image in CI; smoke-test
   the packaged image, not just source execution.
5. Capture representative API/WebSocket fixtures for the five interview modes,
   history pagination, delayed feedback, quotas and errors. Exclude private data.

Exit: reviewed source is reproducible, every required check passes, the existing
APK contract is captured and a previous deployable revision is retained.

## 2. Close interview and feedback reliability gaps

Inspect `processUserInput.js`, `asyncWorker.js`, `terminateSession.js`,
`generateFeedbackReport.js`, `storeFeedbackReport.js` and shared persistence logic.

Add missing regression cases and fix only failures demonstrated by them:

- First question followed by End: discarded, absent from history, no feedback job.
- Accepted answer followed by End: one durable answer and one report outcome.
- Duplicate request or queue delivery: no duplicate accepted answer/report;
  preserve bounded retry accounting for provider attempts.
- Timeout before/after persistence: retry resolves against stored state.
- Delayed worker after termination/deletion: cannot revive the session/account.
- Feedback retry: cannot overwrite newer results or fabricate a fallback score.
- Lost client acknowledgement/reconnect: persisted answers remain retrievable.
- Interrupted audio/replica failure: honest interruption, bounded lease expiry,
  no grading of unfinished capture as a completed answer.

Exit: these invariants pass fault-injection tests. Every asynchronous terminal
path has a persisted outcome or an observable, bounded recovery path. No silent
answer loss or duplicate accepted outcome is accepted as a known release issue.

## 3. Verify security and retention

1. Exercise cross-account access on sessions, history, feedback, resume objects,
   audio tickets and WebSocket operations; include forged/replayed identifiers.
2. Verify expired authentication and revoked/deleted accounts across active work.
3. Test account deletion with queued jobs, active audio and provider callbacks.
   Reconcile all owned stores, retention and eventual cleanup.
4. Recheck SSRF redirects/DNS, file bounds, least-privilege permissions and
   transcript/resume exclusion from ordinary logs.
5. Recheck daily/global limits, stop controls and retry ceilings. Track the
   existing development-only advisory separately; do not force unsafe downgrades.

Exit: all ownership/cleanup tests pass; no unresolved high/critical production
dependency findings or exploitable access-boundary failures. Document actual
retention periods and verify them against deployed settings.

## 4. Validate feedback quality without changing report structure

1. Freeze rubric/prompt versions and agree acceptance criteria before tuning.
2. Use the existing 100 synthetic cases: 98 valid requests and two expected
   context rejections. Obtain two independent blind human reviews per valid case.
3. Run each valid request three times per candidate model: 294 initial model
   calls per model, plus explicitly budgeted retries. Record actual model IDs,
   usage and prompt fingerprints. Do not run paid evaluation without a budget.
4. Measure schema validity, within-case variation, human disagreement and score
   error per module. Manually check whether advice is grounded in the answer.
5. Tune backend prompts, validation and rubric logic against observed errors;
   keep response schema and score meaning compatible with the installed app.
6. Validate on a separate held-out set after tuning. Include consented real
   examples when available; synthetic success alone is insufficient.

Proposed initial targets, to agree before measurement: >=99% valid outputs;
mean absolute score error <=10 points on a 0-100 scale in each module;
three-run score range <=10 points for >=90% of cases; no fabricated quotations
or unsupported personal claims in reviewed reports. Review human disagreements
before attributing every difference to the model. These targets are engineering
release criteria, not proof of fairness, hiring prediction or population accuracy.

Exit: per-module and held-out results meet the agreed criteria, material errors
are investigated and reviewers find the next-practice advice useful. Until then,
continue describing scores as AI practice estimates.

## 5. Make operational failures visible

1. Deploy the existing allowlisted metrics to an isolated acceptance environment.
2. Verify CloudWatch extraction against owned probes for provider failures,
   feedback unavailable, stream interruptions, rejected capacity and stuck work.
3. Add missing aggregate stuck-session/feedback-age measures if existing signals
   cannot detect successful invocations that fail to produce a useful outcome.
4. Configure operator alerts, confirm subscription and trigger controlled alarms.
5. Measure per-completed-interview costs including model tokens, audio, Polly,
   parsing, retries and infrastructure. Establish budget and stop thresholds.
6. Rehearse queue recovery and rollback; verify saved answers survive rollback.

Exit: controlled failures reach the operator, dashboards match probe outcomes,
and recovery/rollback instructions have been executed successfully.

## 6. Establish measured cloud capacity

1. Confirm actual regional provider quotas, network limits and a test-cost budget.
2. Deploy the existing optional two-task topology in an isolated environment;
   verify placement across availability zones and preserve the current service.
3. Start with 2, then 4, then 8 concurrent synthetic users. Use real provider
   connections and realistic 30-180-second answers, all five interview modes,
   resume processing and feedback work. Synthetic silence alone is insufficient.
4. At each step record completion rate and p50/p95 admission, answer-to-question,
   feedback latency, rejection rate, resource use, leases and actual usage cost.
5. Hold the eight-user target for a 30-minute initial soak. Extend the soak when
   observed expiry/queue behaviour requires it. Eight is a test target, not a
   capacity claim or a promise of suitability for arbitrary traffic.
6. With the shared cap intentionally set to eight, burst twelve callers: excess
   callers must receive the existing bounded busy response without harming the
   admitted users. Stay within reviewed quotas; do not raise the current ceiling.
7. Interrupt one replica, test shared admission during failure, drain safely and
   verify no lease remains beyond its documented expiry/reconciliation window.

Proposed initial acceptance: >=98% normal-flow completion across at least 100
interviews, no cross-user mixups or duplicate accepted answers, no persistent
capacity leakage, and explicit recovery for injected failures. Report injected
failures separately from normal-flow completion; never omit their outcomes.
Agree latency budgets after the low-load baseline and before higher-load tests;
do not label local timing as cloud performance or select budgets after seeing
the high-load result. Overload must fail within existing API/client deadlines.

Exit: the measured target passes throughput, latency, cost and failure criteria.
If it fails, identify the bottleneck before changing task count or shared caps.

## 7. Verify the unchanged APK and release gradually

1. Test the exact frozen APK against the candidate backend on two different
   physical Android devices, including a lower-memory model.
2. Complete `DEVICE_ACCEPTANCE.md`: noisy/quiet speech, Bluetooth, permission
   denial, incoming calls, backgrounding, network changes, repeated taps,
   account switching, feedback delays and first-question cancellation.
3. Observe a small consenting beta group using the unchanged interface. Record
   completion, failures and confusion; backend fixes can address service delays
   and wrong data, while UI-only issues remain separately documented.
4. Review the production change set and costs. Deploy compatible consumers
   before producers when queued payloads change. Verify production with owned
   synthetic probes and compare responses with the frozen APK contract.
5. Begin with a controlled beta and cap concurrent usage at verified capacity.
   Expand only while completion, latency, costs and alerts remain acceptable.

Exit: physical acceptance and controlled beta pass, production evidence matches
the intended source/configuration, rollback is ready and frontend hashes match
the baseline. Never advertise a concurrent-user count based solely on replicas.

## Work that can overlap

After phase 1, human review in phase 4 can run while phases 2-3 are implemented.
Operational preparation can start in parallel, but cloud capacity tests depend
on reliability/security fixes and verified telemetry. Release depends on all
gates, not elapsed calendar time. Maintainability work is limited to focused
backend extraction with unchanged-contract regression tests throughout.

## Evidence for each completed phase

Keep a short record of the source/config fingerprints, test command and result,
observed failures, fix, remaining issues and pass/fail decision. Keep credentials,
private datasets and personal transcripts out of source control. Record proposed
targets separately from measured results. No rating increase is a release gate.
