# Qlue

Qlue is an Android voice interview practice app built with Flutter and an AWS
serverless backend. It supports resume interviews, HR practice, self-introduction
coaching, website-based learning, and job-description matching/interviews.

## Current implementation

- Firebase authentication, email verification, password recovery and account deletion.
- Versioned resume uploads, bounded PDF parsing and owned resume selection.
- Adaptive interview questions, speech output, accepted-answer persistence and reconnect recovery.
- Module-specific, evidence-backed content rubrics; saved feedback, history, dashboard and PDF export.
- Daily per-user session and provider safeguards, operational stop controls and durable recovery.

Scores are AI practice estimates. The rubrics have **not been human calibrated**;
recognition confidence is not speaking confidence, and reports do not predict hiring outcomes.

## Audio and deployment state

The source defaults to Android system recognition. Amazon Transcribe Streaming
is selected with `AWS_STT_ENABLED=true` in the app's compile configuration and
requires the backend and shared rollout controls to be enabled independently.
An APK's actual configuration is determined at build time, not by later edits to
`env.json`.

The latest retained deployment records describe AWS transcription enabled with
a CloudFront private origin and an ARM host that stops when idle. See
[the 21 October hosting verification](docs/cost-efficiency-2026-10-21.md).
Those are historical observations; they do not prove today's live deployment.

The public-launch work adds an optional multi-task Fargate configuration,
configurable per-task connection limits, cross-replica admission tests and
operational metrics. **It has not migrated the live host or raised live limits.**
See [public-launch readiness](docs/PUBLIC_LAUNCH.md) before changing infrastructure.

## Architecture

```text
Flutter Android
  ├── Firebase authentication
  ├── REST + authenticated interview WebSocket → API Gateway → Lambda
  │     ├── DynamoDB: sessions, accepted answers, feedback, quotas and recovery
  │     ├── S3 + Textract: owned PDF uploads and bounded parsing
  │     ├── Bedrock: contextual questions and content assessment
  │     └── Polly: question audio
  └── Short-lived audio ticket → private-origin WSS gateway → Transcribe

DynamoDB streams + bounded queues → recovery and feedback workers
```

The gateway persists authoritative recognition evidence. The API does not trust
client-supplied confidence claims. Interrupted audio requires the existing
recovery/confirmation rules; unfinished drafts are not silently graded.
INTRO scores the final introduction, with practice progress shown separately.

## Local setup

Use Node.js 24 and Flutter 3.41.2 / Dart 3.11.0, matching CI. AWS SAM and Docker
are needed for infrastructure lint and packaged ARM64 checks. Android capture
requires Android API 24 or later; other platform folders do not establish voice
capture support.

```powershell
cd backend
npm ci
cd audio-gateway
npm ci --ignore-scripts
cd ../../frontend
flutter pub get
```

Copy `frontend/env.example.json` to the ignored `frontend/env.json` and supply
the intended public API/Firebase client configuration. Keep credentials,
service-account keys and signing material out of source control. Android
Firebase configuration and release signing are described in the release guide.

```powershell
cd frontend
flutter run --dart-define-from-file=env.json
```

Local unit/widget tests and the gateway synthetic load test do not require
AWS credentials or paid provider calls. Real service acceptance requires
separately configured, owned synthetic resources and bounded usage.

## Verification

From the repository root:

```powershell
cd frontend
flutter analyze --no-pub
flutter test --no-pub
cd ../backend
npm test -- --runInBand --coverage
node evaluation/evaluate.cjs
cd audio-gateway
npm test
node scripts/load-smoke.mjs --clients=24 --slots=12 --duration-ms=1600
```

The load smoke uses two local server instances, real WebSocket transports,
synthetic silence and an in-memory transactional boundary. It checks shared
admission and cleanup; it is not an AWS throughput or speech-accuracy benchmark.

Flutter checks run on pull requests and main pushes. Backend CI additionally
checks dependency audits, SAM templates and packaged Linux ARM64 artifacts.
Coverage floors prevent large regressions; coverage does not establish that
every security or recovery behavior has been exercised.

## Project map

| Path | Responsibility |
|---|---|
| `frontend/lib/features/interview/` | Interview orchestration, response recovery and state models |
| `frontend/lib/shared/services/` | Speech capture, audio transport and playback |
| `frontend/lib/screens/` | Authentication, interviews, reports, profile and history |
| `backend/src/handlers/` | Authenticated API, workers and feedback pipeline |
| `backend/src/lib/` | Provider boundaries, deadlines, quotas, metrics and security |
| `backend/audio-gateway/` | Streaming transport, admission, hosting and synthetic load checks |
| `backend/evaluation/` | Synthetic assessment corpus and human/model comparison tooling |
| `backend/template.yaml` | Canonical application infrastructure |
| `audit/` | Verification tools and historical investigations |
| `docs/` | Current guides and dated release evidence |

## Guides

- [Build and release](docs/RELEASES.md)
- [Public launch and concurrency](docs/PUBLIC_LAUNCH.md)
- [Operations, metrics and costs](docs/OPERATIONS.md)
- [Feedback evaluation](docs/FEEDBACK_EVALUATION.md)
- [Device acceptance](docs/DEVICE_ACCEPTANCE.md)
- [Event-driven recovery](docs/event-driven-recovery.md)
- [Account deletion](docs/account-deletion.md)

Dated documents preserve what was observed in that investigation. Consult current
source/configuration and fresh acceptance evidence before treating an older
deployment, price estimate or test count as current.
