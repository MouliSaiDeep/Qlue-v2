# Optional AWS audio gateway

Persistent Node 24/ARM64 service for the experimental Flutter AWS STT provider.
Configuration is OFF by default. The user-authorized AWS-enabled test APK and
deployment are recorded in the [deployment record](../../docs/aws-transcribe-deployment-2026-10-20.md).
Read the [architecture](../../docs/aws-transcribe-streaming.md)
and [validation record](../../docs/aws-transcribe-validation.md) before provisioning.
The ordinary interview control path remains API Gateway/Lambda/SQS.

Current source adds [public-launch preparation](../../docs/PUBLIC_LAUNCH.md):
optional two-to-six-task scale-out, configurable transport limits, shared
transactional admission and privacy-safe EMF metrics. The live hosting topology
is not changed by these source edits. See [operations](../../docs/OPERATIONS.md)
for the metric definitions and [the idle-host record](../../docs/cost-efficiency-2026-10-21.md)
for the most recent retained deployment evidence.

The local concurrency smoke makes no AWS calls:

```sh
node scripts/load-smoke.mjs --clients=24 --slots=12 --duration-ms=1600
```

From this directory:

```sh
npm ci --ignore-scripts
npm test
npm audit --omit=dev --audit-level=high
sam validate --lint --template-file infrastructure.yaml --region us-east-1
sam validate --lint --template-file network.yaml --region us-east-1
docker build --platform linux/arm64 -t qlue-audio-gateway:local-review .
node scripts/container-smoke.mjs --image qlue-audio-gateway:local-review
```

`Dockerfile` runs as a non-root user and copies only `src/` and locked production
dependencies. Use a reviewed ARM64 image digest in the optional infrastructure.
The Alpine runtime upgrades its system packages during the image build. Scan the
resulting ARM64 image, then pin its immutable ECR digest in the deployed task.
Do not copy local AWS credentials, environment files, scripts, evaluations or
recordings into that image. Credentials come from the ECS task role.

`UseManagedTls=true` uses CloudFront's default certificate and hostname with an
internal ALB reached through a VPC origin. Viewer traffic requires HTTPS; audio
is never cached. The origin subnets have no internet route. `UsePublicTaskEgress`
can avoid a NAT gateway by assigning the task a public address for outbound TLS;
its inbound security group still allows only the ALB. The gateway accepts the
overwritten viewer-protocol header only in this explicit private-origin mode.

## Staging tools

These commands make billable AWS requests only when explicitly invoked. They
never activate production flags. Store outputs in private ignored locations.

```sh
# New uniquely named synthetic tables, admission/fence checks, one silence
# stream, then deletion of the synthetic tables.
node scripts/aws-staging-check.mjs --apply --output ../../tmp/aws-stt-isolated-aws.json

# A reviewed existing bucket and a Transcribe-assumable role scoped to its
# public vocabulary object are required. Provision before interviews.
node scripts/provision-vocabulary.mjs --apply --bucket REVIEWED_BUCKET --data-role-arn REVIEWED_ROLE_ARN

# Consent, real references and speaker splits must be filled in a private copy.
node evaluation/replay.mjs --aws --manifest ../../tmp/consented-recordings.json --output ../../tmp/accuracy-report.json

# Debug phone helper, bound only to localhost; creates synthetic tables.
node scripts/phone-gateway.mjs --apply
```

The phone helper is intentionally outside the production container. It bypasses
Firebase only for its isolated synthetic identity; do not expose its HTTP issuer
to a network. Forward port 8788 over ADB USB and use the separate debug-only
`stt_probe_main.dart` app. The helper saves consented audio locally for identical
recording comparisons. POST `{}` to `http://127.0.0.1:8788/shutdown` afterward and
check `tmp/aws-stt-phone/cleanup.json`. That removes only tables it created.
The helper expires after 30 minutes. `resources.json` records its exact planned
and created table names before/during creation. If the process is forcibly
killed, reconcile those names and their `qlue-stt-phone-validation` purpose tags;
do not rely on an older cleanup report or delete unrelated tables by prefix.

WAV replay accepts actual signed PCM16/mono/16-kHz files. Headers are parsed and
stripped. Resample other recordings with a real audio converter first, e.g.
`ffmpeg -i input.wav -ac 1 -ar 16000 -c:a pcm_s16le converted.wav`.
Changing only a WAV header or request sample rate is invalid. Silence remains
in the replay timeline. The example manifest is not consent or a benchmark.
