# AWS Transcribe test deployment — 20 October 2026

The user explicitly requested deployment and an APK using the new AWS
transcription, automatic answer submission, and no commit. The interview screen
matches the local `origin/main` stable screen. Four seconds of silence finishes
the answer; an AWS final segment alone does not. The existing system recognizer
remains available for rollback. Ordinary source defaults remain OFF.

## Artifacts and deployment

- Signed APK: `output/Qlue-1.0.9-aws-stt.apk`, package `com.qlue.sloths1`,
  version name 1.0.9, version code 10009, Android API 24+.
- APK SHA-256: `410630fdd05bd8979ef6fa50087691656337ff76e16ecfb39bd791abe1462461`.
- Signing certificate SHA-256:
  `cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd`.
- Backend: existing `qlue-dev` stack in us-east-1. Existing environment values,
  data resources, API URLs, processing switch and eight enabled worker mappings
  are preserved. The new STT table retains short-lived ticket/transcript evidence.
- New stacks: `qlue-audio-network` and `qlue-audio-gateway`.
- WSS endpoint: `wss://d3g2jyomkdlymm.cloudfront.net/audio`.
- Transcribe language en-IN; stabilization OFF; public technical vocabulary
  `qlue-public-technical-en-IN-v1`, verified READY.
- Bounds: one stream per user, four shared concurrent slots, 20 daily stream
  starts, maximum 180 seconds per stream. Retries consume starts too.

The rollout is enabled for the AWS-enabled test APK. The authenticated deployed
audio smoke test passed after the evidence fix. Final activation and verification
records are under `tmp/aws-stt-deploy-20261020/`.
No Git commit, push or GitHub release was made. The local ignored `env.json`
selects AWS transcription for subsequent local builds.

## Network and runtime

CloudFront provides an AWS-managed HTTPS/WSS hostname and certificate. Its
distribution requires HTTPS, disables caching, and reaches an internal ALB
through a VPC origin. Two dedicated origin subnets have only the VPC local route.
The ALB accepts only the AWS-managed CloudFront origin-facing prefix list.
The gateway's private-origin mode requires the overwritten HTTPS viewer header.
The ordinary direct-ALB mode still requires HTTPS forwarding.

A single ARM64 Fargate task uses 0.25 vCPU and 0.5 GiB. Its public address is for
outbound TLS without a NAT gateway; its security group accepts port 8080 only
from the ALB security group. AWS access uses the task role. The container runs
as non-root with a read-only root filesystem and dropped Linux capabilities.
The final Alpine image upgrades system packages and is pinned by immutable ECR
digest. ECR's ARM64 image scan completed with no findings before activation.

The first deployed synthetic stream exposed a reserved-word bug in the final
evidence update (`segments`). Shared admission was closed automatically and the
synthetic identity/records were removed. The expression now aliases that field.
A successful real-DynamoDB evidence write/read was added to isolated staging;
all eight staging checks passed and its three temporary tables were removed.
Gateway tests also ensure failed persistence cannot report answer completion
and operational error metrics do not log transcript contents.

The final live check used a newly created, verified synthetic Firebase identity
and one owned synthetic question. Unauthenticated requests and the wrong question
were rejected. A real WSS stream received finalized synthetic speech and the
server persisted it before reporting completion. The persisted evidence passed
the backend ownership contract; the task applied the READY vocabulary. The
synthetic identity and rows were then removed. This check did not submit a real
candidate answer, trigger feedback or send email.

The 8.559-second replay included four seconds of trailing silence. Its server
first partial was observed about 743 ms after first PCM arrival; the final
segment arrived an estimated 143 ms after its AWS EndTime on the server clock.
Client replay-to-complete was about 10.615 seconds. These are single synthetic
observations with separate clocks, not human WER, p50/p95 or full conversation
latency. The recognized phrase was “I build mobile applications with Flutter and
Amazon Dynamo DB.” Applying a vocabulary does not guarantee every desired
display spelling on every recording.

## Cost and practical limits

At 730 hours/month, the estimated fixed baseline is about $27.30/month:
roughly $7.21 for the task, $16.43 for the internal ALB, and $3.65 for one public
task IPv4 address. Load-balancer capacity, CloudFront transfer/requests, ECR,
logs, DynamoDB, Transcribe and existing application services are additional.
Credits/free allowances/tax are excluded. No NAT gateway was added.
Rates were checked against [Fargate pricing](https://aws.amazon.com/fargate/pricing/),
[ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) and
[IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

This is a bounded test deployment, not evidence of improved human accuracy.
No Android device was attached during the deployment. Human WER, thinking-pause
behavior in real noise, interruption handling on a phone and full conversation
latency still need device acceptance. A four-second pause alone prevents a
subsecond speech-end-to-response target. Recognition confidence is not interview
ability or measured transcription accuracy.

## Rollback preparation

The pre-update backend snapshot includes the original and processed templates,
parameters, all 60 original function configurations and five exact code/layer ZIP
artifacts (59,651,228 bytes). These private ignored files are under
`tmp/aws-stt-deploy-20261020/private/`; do not commit them. Previous deployed
Lambda layers were retained. The stable-speech signed APK is
`tmp/aws-stt-deploy-20261020/Qlue-1.0.9-stable-rollback.apk`.

`tmp/aws-stt-deploy-20261020/rollback-feature.cjs` is prepared and has not been
executed. Its explicit `--apply` mode disables shared admission first, then
disables the ticket/runtime flags and scales the audio task to zero. It also
returns the local app configuration to the system recognizer. Install the saved
stable APK in place; do not uninstall or clear app data. Both APKs have the same
package/version/signing key, so this does not require an Android version downgrade.

Do not switch recognizers within an active answer. The shared kill switch closes
active AWS streams on their next bounded authorization check. Retain evidence
until receipts and cleanup finish. A feature rollback does not delete the ALB,
CloudFront distribution, network, tables or user data. The ALB's fixed charge
continues until the separately reviewed gateway cleanup disables its deletion
protection and removes that stack. The exact baseline template/artifacts are
available if a full backend restoration is required.
