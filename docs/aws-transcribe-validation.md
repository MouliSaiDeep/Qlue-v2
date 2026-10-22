# Amazon Transcribe validation and rollout record

Validation updated: 2026-10-20 (Asia/Calcutta). Region: us-east-1.
Source defaults: **disabled**. The user subsequently requested deployment and an
AWS-enabled APK with automatic submission. See the
[deployment record](aws-transcribe-deployment-2026-10-20.md) for live status,
costs and rollback preparation. Human accuracy and device acceptance remain
unverified. No Git commit or push was made. Version remains 1.0.9+10009.

## Checks completed

| Check | Result | Scope |
| --- | --- | --- |
| Backend Jest | 69 suites / 496 tests passed on Windows and Linux ARM64 | Linux run uses the actual SAM production dependencies; no deployment |
| Ticket/evidence tests | 20 tests passed within the full suite | Includes malformed input rejection and lost completion recovery |
| Flutter baseline | 247 tests passed before the hands-free adjustment | Prior full-suite run; current change coverage is below |
| Hands-free interview checks | 24 tests passed | AWS service, screen flow and reconnect contract suites; no Done button, four-second automatic submission, TTS ordering, recovery without a button, exactly-once evidence submission and permission denial without retry loops |
| Android native | 3 JUnit tests passed; debug APK built | Real Android compilation; byte-preserving PCM assembly, offsets and short tail |
| Gateway | 21 Node tests passed | Real loopback WebSockets with mocked upstream; includes disconnect during admission, cleanup-aware draining, private CloudFront ingress and failed-persistence reporting without transcript leakage |
| Dependency audit | 0 gateway production vulnerabilities | npm audit; pinned lockfile |
| Canonical SAM and optional gateway IaC | Both lint validations passed | Includes conditions and IAM; not a deployed CloudFormation stack |
| Isolated AWS staging | 7 checks passed | Real DynamoDB transactions and Transcribe Streaming, described below |
| Final isolated evidence regression | 8 checks passed | Includes an actual successful final-evidence write/read after aliasing the DynamoDB reserved `segments` attribute; all synthetic tables deleted |
| Gateway container | Linux ARM64 build and smoke passed | Non-root, read-only root, disabled upgrade rejection, health and graceful shutdown; no AWS credentials supplied |
| Deployed gateway image scan | Complete, no findings | Patched Alpine ARM64 image; the initial Debian candidate was replaced before activation |
| Deployed authenticated audio path | Passed after evidence fix | Real verified Firebase identity, ticket API, private-origin WSS, Transcribe, READY vocabulary and authoritative stored evidence; synthetic identity/rows removed |
| SAM container build and package audits | Passed, 61 functions | 196,625,628 bytes maximum combined extracted package, under the 209,715,200-byte repository limit; no credential/development files or dependency drift |
| Native ARM64 dependency smoke gates | Passed | Three packaged parser cases; verified delivery-model hash and actual native inference on synthetic silence |
| Flutter analysis | No issues found | Full analyzer run; no production feature activation |

Local command evidence is under ignored `tmp/aws-stt-*`. It may contain private
test material and must not be committed. The separate phone probe APK is
`tmp/aws-stt-phone/Qlue-STT-Probe.apk`; its package ID was checked as
`com.qlue.sloths1.sttprobe`, separate from the installed Qlue app.

The real AWS staging test created three unique synthetic tables, then verified:
one concurrent stream per user, single-use redemption, shared global slots,
expired/wrong-question rejection, deletion revocation plus late-write fencing,
the shared kill switch, and successful drainage of a real en-IN PCM silence
stream. All three temporary table deletions were accepted. No production tables,
IAM policies, user accounts or feature flags were changed. A separate loopback
phone helper also creates only synthetic tables and is shut down with cleanup
after device testing. Following an interrupted terminal, the three remaining
phone-test tables were checked for purpose and synthetic ownership, deleted,
and verified absent. The helper now journals exact resource identities before
creation and expires after 30 minutes; its successful cleanup report is no
longer reused across new runs.

The silence request proves AWS transport/configuration. It contains no speech
and proves neither recognition accuracy nor conversational response latency.
WebSocket, permission, interruption, TTS-boundary and exactly-once tests use
controlled fakes unless explicitly identified as real AWS or device checks.

The replay harness was also exercised against real AWS with the reference
trial's synthetic speech fixture. Its actual original rate is 22,050 Hz; the
harness correctly rejected it, then accepted a separately converted mono PCM16
16-kHz copy created with FFmpeg. The original file was not changed. The 4.559 s
replay completed with no unfinished segment and recognized the synthetic phrase
“I build mobile applications with Flutter and Amazon Dynamo DB.” Stabilization
was OFF and no vocabulary was applied. First partial was observed at 2,906 ms
from first PCM yielded; the single final segment's estimated delivery lag was
394 ms after its AWS EndTime on the replay clock. Those are individual synthetic
observations, not p50/p95, human accuracy, network isolation or end-to-end app
response latency. The harness correctly withheld human WER and paired results.

## Device and accuracy status

A physical Android API 36 phone was detected. It went offline during the
isolated probe installation; ADB returned an installation failure. No successful
installation, microphone capture, backgrounding, Bluetooth/call interruption,
permission dialog or same-recording Android replay has yet been established.
The user's existing Qlue app and data were not replaced or cleared.

| Measurement | Android system recognizer | Amazon Transcribe |
| --- | --- | --- |
| Representative human-reference WER | Not measured | Not measured |
| Technical-term recognition on representative speakers | Not measured | Not measured |
| Confidence usefulness on held-out speakers | Unavailable | Not measured/calibrated |
| Client first partial p50/p95 | Not measured | Insufficient observations |
| Last speech to first meaningful assistant audio | Not measured | Not measured |

There is no measured accuracy improvement to claim. The reference trial's
synthetic speech and browser microphone checks are not representative human
benchmarks. No latency percentile is reported from fewer than 30 observations.

Use `backend/audio-gateway/evaluation/manifest.example.json` as a schema example;
its consent and human-reference flags are deliberately false. Copy it into
ignored private storage, obtain consent, correct each reference by listening,
and record the actual device, accent, headset and noise. Keep speaker IDs
disjoint between calibration and evaluation. Replay the exact same recording
through both recognizers on Android API 33+ where injection is supported.
Report unsupported injection explicitly. Use the existing system hypothesis in
the manifest rather than comparing unrelated live utterances.

WER normalization ignores case/punctuation/apostrophes; it does not silently
expand numbers or acronyms. Technical-term aliases are separate from WER.
Missing confidence is null, zero is preserved, and deletions have no recognized
word score. The diagnostic 0.80 threshold has no calibrated interpretation.

## Remaining release gates

1. Finish physical-device normal stop, trailing word, permission denial,
   background/resume, interruption, headset/route and repeated-answer checks.
2. Exercise real Firebase identity issuance through a reviewed staging HTTPS
   endpoint and real public WSS through ACM/ALB/Fargate, including multiple tasks,
   task termination, account deletion and TLS/network failure. The USB helper
   uses a synthetic identity and cannot establish those deployment properties.
3. Provision the public versioned vocabulary, wait for READY and compare baseline
   versus applied vocabulary. READY/language/cache logic is unit-tested; actual
   vocabulary provisioning has not been run against AWS for this change.
4. Collect consented representative recordings across speakers/accents/devices,
   headsets and noise. Publish paired WER/error counts/technical-term results and
   confidence diagnostics. Keep broad rollout OFF unless results warrant it.
5. Profile complete conversational timing separately: endpoint wait, transport,
   SQS, Lambda startup, model generation, Polly synthesis and playback. The
   four-second automatic pause alone prevents a subsecond response target.

The initial Docker startup failed, but after the environment resumed the Linux
engine became available. The ARM64 image smoke check, SAM container build and
package audits were then completed successfully. These remain explicit CI
checks. They do not establish public TLS, AWS network topology or multi-task
deployment behavior.

The first full ARM64 Jest attempt on the Windows bind mount hit an existing
audio-refresh test's five-second timeout. The completed run used an isolated
copy on the container's Linux filesystem, a 30-second Jest timeout and the
existing 120-second subprocess allowance for emulation. All 496 tests then
passed. No application deadlines were relaxed. A locked Linux ARM64 binding
needed by the test runner was integrity-verified and added only to ignored
local test dependencies. These are functional checks, not Lambda latency
measurements; CI uses a native ARM64 runner.

## Incremental cost estimate

These are estimates in USD, excluding tax, credits/free tier and existing
interview model/TTS costs. Rates were checked against official AWS pages on
2026-10-19; verify again before rollout.

The current AWS standard-pricing page gives a us-east-1 streaming example at
**$0.01 per audio minute**, billed in one-second increments with **no minimum**.
That differs from older $0.024/minute / 15-second-minimum references. The harness
therefore reports audio duration and estimated rounded seconds, not an invoice.
At the displayed rate, 10 minutes is about $0.10 and 1,000 minutes about $10.
[Amazon Transcribe pricing](https://aws.amazon.com/transcribe/pricing/)

Illustrative 30-day always-on baseline (720 hours), with a dedicated ALB:

| Component | Assumption | Approximate monthly cost |
| --- | --- | --- |
| One ARM Fargate task | 0.25 vCPU, 0.5 GB; CPU $0.0000089944/vCPU-second and memory $0.0000009889/GB-second | $7.11 |
| Dedicated ALB | $0.0225/hour | $16.20 plus LCUs |
| ALB public IPv4 | Two addresses at $0.005/address-hour | $7.20, more if the ALB allocates more addresses |
| Subtotal | One task, no usage or egress extras | About $30.51 |
| Second task for availability | Same task size | Add about $7.11 |

These calculations use the official
[Fargate ARM example](https://aws.amazon.com/fargate/pricing/),
[ALB prices](https://aws.amazon.com/elasticloadbalancing/pricing/) and
[public IPv4 prices](https://aws.amazon.com/vpc/pricing/).
ALB LCUs, network egress/NAT or paid VPC endpoints, DNS, ECR storage, DynamoDB
reads/transactions/storage, API/Lambda issuance and CloudWatch logs are extra.
The template expects existing reviewed private-subnet egress; creating a
dedicated NAT path can materially increase the baseline. Setting task count to
zero still incurs ALB charges if the ALB remains provisioned. With provisioning
OFF, no gateway ALB/Fargate resources are created by default.

Each active stream polls authorization every two seconds: up to roughly 270
consistent item reads for a full three-minute answer, plus admission/evidence
transactions. This trades a small usage cost for bounded termination/deletion
revocation. There are no per-chunk Lambda, SQS or DynamoDB operations.

The default shared admission cap is 20 streams/day, four concurrent globally and
one per user, each at most 180 seconds. Thus at most 60 submitted audio minutes
are admitted per UTC day under unchanged defaults, approximately $0.60/day at
the displayed streaming rate. Retries consume admissions too. This bounds
admitted audio usage, not the total AWS invoice; infrastructure, credential
misuse outside this service, rate changes and rollout configuration remain
separate. The limits can be lowered in CONTROL and cannot be increased by a
single replica's local settings.

At low usage, a dedicated always-on gateway costs more than Android recognition.
Reuse an existing suitable AWS runtime/ALB where reviewed, keep staging tasks
scheduled or stopped when unused, and justify broader activation with measured
accuracy gains. Do not trade away silence preservation or fail-visible audio
handling to save transcription seconds.
