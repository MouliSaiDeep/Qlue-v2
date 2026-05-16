# Qlue v2 — AI-Powered Voice Interview Simulation Platform

> **An end-to-end, AI-native mobile platform that simulates real-world technical and behavioural interviews using voice, NLP, and contextual LLM reasoning — helping candidates practice, receive feedback, and improve before their actual interviews.**

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Proposed Solution](#proposed-solution)
3. [System Architecture](#system-architecture)
4. [Technologies Used](#technologies-used)
5. [Interview Modules (In-Scope)](#interview-modules-in-scope)
6. [Out of Scope](#out-of-scope)
7. [Getting Started](#getting-started)
8. [Project Structure](#project-structure)
9. [AI Integration](#ai-integration)
10. [Future Enhancements](#future-enhancements)
11. [Contributing](#contributing)

---

## Problem Statement

Job seekers — especially students and early-career professionals — consistently struggle with interview preparation. Despite having the technical skills required for a role, candidates often fail interviews due to lack of **structured practice**, inability to receive **real-time objective feedback**, and no access to a realistic, interactive interviewer.

Existing solutions (YouTube videos, mock-interview apps, coaching services) are either:
- **Static and passive** — no interactivity or adaptive follow-up
- **Expensive** — human mock-interview coaches cost $50–$200/hour
- **Disconnected from the candidate's actual profile** — generic question banks that don't reflect the individual's resume, skills, or target role

Qlue v2 solves this by providing a **voice-first AI interviewer** that reads the candidate's actual resume, tailors every question to their background, evaluates spoken responses in real time, and generates a rich feedback report — all free and on-demand.

---

## Proposed Solution

Qlue v2 is a full-stack, serverless, AI-native platform consisting of:

1. **A Flutter mobile app** (iOS, Android, Web) that acts as the interview client — handling voice input (STT), audio playback (TTS), real-time session state via WebSocket, and visualisation of feedback reports.

2. **A Node.js serverless backend** (AWS SAM / Lambda) that orchestrates the interview lifecycle — session management, LLM query construction, scoring, transcript persistence, and push notifications.

3. **An LLM pipeline** built on **Amazon Bedrock** (primary model: `nvidia/nemotron-super-3-120b`) and **Anthropic Claude 3 Haiku** (feedback model) that generates contextual interview questions, scores candidate responses across defined dimensions, and produces qualitative feedback reports.

The system supports **four distinct AI-driven interview modules**:

| Module | Description |
|--------|-------------|
| **RESUME** | Technical interview based on the candidate's uploaded resume |
| **HR** | Behavioural interview using STAR-framework questions |
| **INTRO** | Self-introduction coaching for perfecting the "tell me about yourself" pitch |
| **WEBSITE** | Adaptive tutoring from any web URL — user shares a link and is quizzed on its content |

Every spoken response is transcribed (via `speech_to_text`), sent to the backend, scored by Bedrock, and the AI's reply is synthesised by **Amazon Polly** (5 selectable voice personas) and played back to the candidate in real time via `just_audio`.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Flutter Client (Mobile/Web)               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Auth Screen │  │ Resume Upload│  │  Interview Session UI  │  │
│  │ (Firebase)  │  │ (S3 presign) │  │  STT → WS → TTS       │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬────────────┘  │
│         │                │                        │               │
└─────────┼────────────────┼────────────────────────┼───────────────┘
          │  REST (Dio)    │  REST (Dio)             │  WebSocket
          ▼                ▼                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                   AWS API Gateway (REST + WebSocket)              │
│   /auth/*     /resume/*    /interview/*    /dashboard/*           │
└──────┬────────────┬────────────────┬────────────────┬────────────┘
       │            │                │                │
       ▼            ▼                ▼                ▼
┌────────────┐ ┌──────────┐  ┌──────────────┐ ┌──────────────────┐
│ Auth       │ │ Resume   │  │  Interview   │ │ Dashboard        │
│ Lambdas    │ │ Lambdas  │  │  Lambdas     │ │ Lambdas          │
│ (Firebase  │ │ (S3,     │  │  (Session,   │ │ (Score trends,   │
│  JWT)      │ │ Textract)│  │   Bedrock,   │ │  history,        │
└─────┬──────┘ └────┬─────┘  │   Polly,WS)  │ │  transcripts)    │
      │             │        └──────┬───────┘ └──────────────────┘
      ▼             ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AWS Services Layer                        │
│  DynamoDB (8 tables)   S3 (3 buckets)   Bedrock   Polly         │
│  Secrets Manager       SNS              Textract  Firebase FCM   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow — Interview Session

```
1. POST /interview/initialize
   └── initializeSession.js → createSession() (DynamoDB) → returns { sessionId, wsUrl }

2. WebSocket connect: connectHandler.js → stores connectionId

3. [User speaks] → Flutter STT → text → WS sendText
   └── sendTextHandler.js → asyncWorker.js → processUserTurn()
       ├── saveTranscript() (DynamoDB)
       ├── invokeModel() → Bedrock (score dimensions)
       ├── manageContextWindow() (rolling 20-turn window)
       ├── generateQuestion.js → buildInterviewPrompt() → Bedrock stream
       ├── synthesizeSpeech.js → Polly → S3 presigned URL
       └── stateUpdateHandler.js → pushes { audio_url, transcript } via WS

4. POST /interview/terminate
   └── terminateSession.js → SNS publish → FeedbackTriggerTopic
       └── analyzeTranscript.js → computeModuleScores.js
           └── generateFeedbackReport.js → storeFeedbackReport.js
               └── sendFeedbackNotification.js → FCM push
```

### DynamoDB Tables

| Table | Purpose |
|-------|---------|
| `qlue-users` | User profiles, voice preferences, FCM tokens |
| `qlue-resumes` | Resume metadata, parsed data (Textract), active flag |
| `qlue-sessions` | Interview session lifecycle, state machine, accumulated scores |
| `qlue-transcripts` | Per-turn transcripts (speaker, text, turn index) |
| `qlue-feedback` | Generated feedback reports with dimension scores |
| `qlue-concept-states` | WEBSITE module concept mastery tracking |
| `qlue-ws-connections` | Active WebSocket connection IDs per session |
| `qlue-notifications` | Push notification records |

---

## Technologies Used

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Flutter / Dart** | SDK ^3.11.0 | Cross-platform mobile and web UI |
| **Provider** | ^6.1.2 | State management (AuthProvider, ResumeProvider, DashboardProvider, InterviewProvider) |
| **Dio** | ^5.4.0 | HTTP client for REST API calls |
| **web_socket_channel** | ^3.0.3 | Real-time WebSocket communication with backend |
| **speech_to_text** | ^7.3.0 | On-device speech recognition (STT) |
| **just_audio** | ^0.9.36 | Audio playback of Polly-synthesised TTS |
| **Firebase Auth** | ^6.4.0 | Email/password and Google Sign-In |
| **Firebase Messaging** | ^16.2.0 | Push notifications for feedback completion |
| **go_router** | ^17.2.1 | Declarative navigation |
| **google_fonts** | ^8.0.2 | Typography |
| **envied** | ^0.5.4 | Compile-time environment variable injection |

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | v24.x (arm64) | Lambda runtime |
| **AWS SAM** | — | Infrastructure-as-Code, local testing |
| **Amazon Bedrock** | `@aws-sdk/client-bedrock-runtime` ^3.x | Primary LLM — `nvidia/nemotron-super-3-120b` for interview reasoning; Claude 3 Haiku for feedback |
| **Amazon Polly** | `@aws-sdk/client-polly` ^3.x | Text-to-speech synthesis (5 voice personas) |
| **Amazon Textract** | `@aws-sdk/client-textract` ^3.x | Resume PDF parsing |
| **Amazon DynamoDB** | `@aws-sdk/client-dynamodb` + `lib-dynamodb` | Primary data store (8 tables) |
| **Amazon S3** | `@aws-sdk/client-s3` ^3.x | Resume storage, audio output, scraped content |
| **Amazon SNS** | `@aws-sdk/client-sns` ^3.x | Async feedback pipeline trigger |
| **AWS API Gateway** | — | REST API + WebSocket API |
| **Firebase Admin SDK** | ^13.8.0 | JWT token validation, FCM push |
| **Jest** | ^30.4.2 | Unit and integration testing |

### AI / ML Stack
| Service | Role |
|---------|------|
| **Amazon Bedrock — Nemotron-super-3-120b** | Question generation, response scoring, concept extraction |
| **Anthropic Claude 3 Haiku (via Bedrock)** | Qualitative feedback report generation |
| **Amazon Polly** | Neural TTS — Tiffany, Ruth, Joanna, Matthew, Stephen |
| **Amazon Textract** | Resume OCR and structured extraction |

---

## Interview Modules (In-Scope)

### 1. RESUME Module
- User uploads a PDF resume → Textract parses it into structured JSON (name, skills, experience, projects)
- `initializeSession` creates a session tied to the `resumeId`
- `generateQuestion.js` → `buildInterviewPrompt()` constructs a per-turn system prompt injecting resume summary, conversation history, and dimension focus
- Bedrock generates the next question (streamed token by token)
- Response is scored across: `clarity`, `fluency`, `technicalVocabulary`, `useOfExamples`
- Running average accumulated every turn via `interviewService.processUserTurn()`

### 2. HR Module
- Behavioural interview using STAR-framework prompt templates
- `buildHrPrompt()` in `generateQuestion.js` — adapts dynamically to candidate's prior answers
- Scored on: `teamwork`, `ethicalThinking`, `problemSolving`, `communicationClarity`, `selfAwareness`

### 3. INTRO (Self-Introduction) Module
- 3-turn coaching loop: "Tell me about yourself" → specific feedback → refinement
- `buildIntroPrompt()` switches instruction per turn index
- Scored on: `clarity`, `structure`, `confidence`, `relevance`

### 4. WEBSITE Module
- User provides a URL → `fetchAndCleanContent.js` scrapes and cleans it via Scrape.do
- `buildConceptExtractionPrompt()` extracts 3–5 key concepts via Bedrock
- `buildWebsiteTeachPrompt()` constructs adaptive tutoring prompts per concept
- Concept mastery tracked in `qlue-concept-states` table (PENDING → TUTORED → MASTERED)
- Scored on: `comprehensionAccuracy`, `learningProgression`, `criticalThinking`, `responseClarity`, `conceptRetention`

### Session Lifecycle & State Machine

```
INITIALIZING → AI_SPEAKING → AWAITING_USER_INPUT → PROCESSING
     ↑                                                   │
     └───────────────────────────────────────────────────┘
                        (each turn)
                             │
                        TERMINATED
                             │
                      (async feedback pipeline)
                      analyzeTranscript → computeModuleScores
                      → generateFeedbackReport → FCM push
```

- Silence detection: 3 retries before auto-terminate
- Concurrency lock: one active session per user (409 if violated)
- Context window management: rolling 20-turn window to stay within Bedrock token limits

### Resume Management
- `generatePresignedUrl.js` → S3 presigned upload URL
- `processResumeUpload.js` → Textract job → structured parsed data stored in DynamoDB
- `validateResumeHash.js` → SHA-256 deduplication to avoid re-processing identical files
- `setActiveResume.js` → atomic active-flag swap (only one active resume per user)
- `deleteResume.js` → cascading delete from S3 and DynamoDB

### Dashboard & Analytics
- `getDashboardSummary.js` — aggregated stats: total sessions, avg score, top module
- `getScoreTrends.js` — per-dimension score over time for chart rendering
- `getModuleStats.js` — breakdown by module type
- `getSessionHistory.js` + `getSessionDetail.js` — full session replay
- `getTranscript.js` — per-session full transcript retrieval

### Authentication
- Firebase Auth: email/password (`registerUser`, `loginUser`) and Google OAuth (`loginWithGoogle`)
- Custom JWT validation via `validateToken.js` (Firebase Admin SDK)
- Token refresh via `refreshToken.js`
- FCM token management via `updateFcmToken.js` for push notifications

---

## Out of Scope

The following features are **explicitly not included** in v2:

- **Live human interviewer pairing** — no peer-to-peer or recruiter-facing interface
- **Video recording or analysis** — voice-only; no camera or facial expression scoring
- **Payment / subscription management** — all features are free-tier in v2; no Stripe or billing integration
- **Company-specific question banks** — no curated database of company-specific interview questions (e.g., "Google interview questions")
- **Multi-language support** — English only in v2; no i18n or multilingual STT/TTS
- **Recruiter/employer portal** — no hiring-side features; candidate-facing only
- **Offline mode** — requires active internet for Bedrock, Polly, and WebSocket

---

## Getting Started

### Prerequisites

- Flutter SDK ≥ 3.11.0
- Node.js ≥ 18, AWS CLI, AWS SAM CLI
- Firebase project (Auth + FCM configured)
- AWS account with Bedrock model access enabled for `nvidia.nemotron-super-3-120b`

### Backend Setup

```bash
cd backend
npm install

# Copy environment template
cp .env.example .env
# Fill in: AWS_REGION, BEDROCK_MODEL_ID, FIREBASE credentials

# Deploy with SAM
sam build
sam deploy --guided
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
flutter pub get

# Set up envied env file
cp .env.example .env
# Fill in: API_BASE_URL, WS_BASE_URL, Firebase config

# Generate env.g.dart
dart run build_runner build --delete-conflicting-outputs

# Run
flutter run
```

### Running Tests

```bash
# Backend unit + integration tests
cd backend && npm test

# Frontend widget + provider tests
cd frontend && flutter test
```

---

## Project Structure

```
Qlue-v2-main/
├── backend/
│   ├── src/
│   │   ├── handlers/
│   │   │   ├── auth/          # registerUser, loginUser, loginWithGoogle, refreshToken,
│   │   │   │                  # validateToken, getUserProfile, updateUserProfile,
│   │   │   │                  # updateFcmToken, syncUser, deleteAccount, logoutUser
│   │   │   ├── interview/     # initializeSession, generateQuestion, processUserInput,
│   │   │   │                  # controlTurnFlow, asyncWorker, manageContextWindow,
│   │   │   │                  # synthesizeSpeech, terminateSession
│   │   │   ├── resume/        # generatePresignedUrl, processResumeUpload, getResumeList,
│   │   │   │                  # getResumeDetail, setActiveResume, deleteResume,
│   │   │   │                  # validateResumeHash, updateResumeParsedData
│   │   │   ├── feedback/      # triggerFeedbackGeneration, analyzeTranscript,
│   │   │   │                  # computeModuleScores, generateFeedbackReport,
│   │   │   │                  # storeFeedbackReport, sendFeedbackNotification
│   │   │   ├── dashboard/     # getDashboardSummary, getScoreTrends, getModuleStats,
│   │   │   │                  # getSessionHistory, getSessionDetail, getTranscript
│   │   │   ├── websocket/     # connectHandler, disconnectHandler, sendTextHandler,
│   │   │   │                  # stateUpdateHandler, errorHandler
│   │   │   ├── scraper/       # fetchAndCleanContent
│   │   │   └── website/       # validateWebsite
│   │   ├── lib/
│   │   │   ├── bedrock.js     # Bedrock client, all prompt builders, invokeModel/Stream
│   │   │   ├── dynamodb.js    # DynamoDB client wrapper
│   │   │   ├── polly.js       # TTS synthesis
│   │   │   ├── textract.js    # Resume PDF extraction
│   │   │   ├── s3.js          # S3 operations + presigned URLs
│   │   │   ├── sns.js         # SNS publish (feedback trigger)
│   │   │   ├── websocket.js   # API Gateway WS management
│   │   │   ├── firebase.js    # Firebase Admin init
│   │   │   ├── fcm.js         # FCM push notifications
│   │   │   ├── scraper.js     # Web scraping client
│   │   │   ├── secrets.js     # Secrets Manager
│   │   │   ├── errors.js      # Custom QlueError class + error codes
│   │   │   ├── logger.js      # Structured logging
│   │   │   └── response.js    # Lambda response helpers
│   │   ├── models/
│   │   │   ├── session.js     # Session CRUD + state machine
│   │   │   ├── transcript.js  # Transcript CRUD
│   │   │   ├── user.js        # User CRUD
│   │   │   ├── resume.js      # Resume CRUD
│   │   │   ├── feedback.js    # Feedback report CRUD
│   │   │   ├── conceptState.js# Concept mastery CRUD
│   │   │   └── wsConnection.js# WebSocket connection CRUD
│   │   └── services/
│   │       └── interviewService.js  # Core turn-processing business logic
│   ├── tests/
│   │   ├── unit/              # 15+ unit test suites (Jest)
│   │   └── integration/       # interviewFlow.test.js end-to-end
│   ├── template.yaml          # AWS SAM IaC definition
│   ├── package.json
│   └── server.js              # Local Express dev server
│
└── frontend/
    ├── lib/
    │   ├── main.dart
    │   ├── app.dart
    │   ├── components/        # avatar, glass_card, spider_chart, spectral_background,
    │   │                      # staggered_fade_in, resume_card, premium_flip_card, etc.
    │   ├── context/           # auth_provider, resume_provider, dashboard_provider
    │   ├── features/interview/providers/interview_provider.dart
    │   ├── core/
    │   │   ├── constants/     # api_constants, app_constants, model_constants
    │   │   ├── models/        # dashboard_model, feedback_report_model, resume_model, session_model
    │   │   ├── network/       # dio_client, websocket_client
    │   │   └── services/      # dashboard_api_service, resume_api_service
    │   ├── screens/
    │   │   ├── auth/          # login_screen, register_screen
    │   │   ├── interview/     # interview_session_screen, feedback_report_screen, dot_matrix_painter
    │   │   ├── resume/        # resume_upload_screen, resume_detail_screen
    │   │   ├── tabs/          # dashboard_screen, history_screen, ai_modules_screen, profile_screen
    │   │   └── profile/       # help_support_screen
    │   └── shared/services/   # stt_service, tts_service, notification_service
    ├── test/                  # 10 test files covering providers, models, flows, widgets
    └── pubspec.yaml
```

---

## AI Integration

Qlue v2's AI pipeline is deeply integrated across multiple service boundaries:

### 1. LLM Question Generation (Amazon Bedrock — Nemotron)
- **File:** `backend/src/handlers/interview/generateQuestion.js`
- Per-module prompt builders: `buildInterviewPrompt()`, `buildHrPrompt()`, `buildWebsiteTeachPrompt()`, `buildIntroPrompt()`
- Streaming via `ConverseStreamCommand` for low-latency token delivery to the WebSocket
- Relevance detection (`analyzeResponseRelevance`) redirects off-topic or too-short answers

### 2. Real-Time Response Scoring (Amazon Bedrock)
- **File:** `backend/src/services/interviewService.js` + `backend/src/lib/bedrock.js`
- `buildScoringPrompt()` — scores each candidate response across 4–5 dimensions (1–100)
- Running average calculated each turn: `newAvg = prevAvg + (newVal - prevAvg) / turnNumber`
- Scores accumulated in session record; final report uses these averages (Bedrock fallback only if no accumulated scores)

### 3. Qualitative Feedback Report (Anthropic Claude 3 Haiku via Bedrock)
- **File:** `backend/src/handlers/feedback/generateFeedbackReport.js`
- `buildFeedbackPrompt()` — generates structured JSON: `{ strengths: [], improvements: [] }`
- Triggered asynchronously via SNS after session termination

### 4. Concept Extraction — WEBSITE Module (Amazon Bedrock)
- **File:** `backend/src/lib/bedrock.js` → `buildConceptExtractionPrompt()`
- Extracts 3–5 teachable concepts from scraped web content
- Each concept cycles through PENDING → TUTORED → MASTERED state machine

### 5. Resume Parsing (Amazon Textract)
- **File:** `backend/src/lib/textract.js` + `backend/src/handlers/resume/processResumeUpload.js`
- OCR + structured field extraction from uploaded PDF resumes
- Parsed output stored in DynamoDB and injected into interview prompts

### Voice Personas (Amazon Polly)
| Polly Voice ID | In-App Name |
|---------------|-------------|
| Tiffany | Emma |
| Ruth | Rachel |
| Joanna | Sarah |
| Matthew | Chris |
| Stephen | Steve |

---

## Future Enhancements

The current codebase is architected to support the following planned features with minimal rework:

### 1. Multi-Round Interview Simulation
- The `session.js` model's state machine and `interviewService.js`'s modular turn processor already support extended session lengths
- Planned: configurable round counts (e.g., 3-round interview: INTRO → RESUME → HR) chained in a single session

### 2. Company-Specific Question Packs
- `generateQuestion.js` prompt builders accept a `context` object — adding a `companyProfile` field requires only a prompt template extension
- Planned: curated packs for FAANG, startups, by role (SDE, PM, DS) delivered via a new `QuestionPacksTable`

### 3. Peer-to-Peer Mock Interview Mode
- WebSocket infrastructure (`connectHandler`, `sendTextHandler`, `stateUpdateHandler`) already supports multi-connection sessions
- Planned: extend `wsConnection.js` model to allow two connectionIds per session for paired practice

### 4. Video Analysis & Non-Verbal Feedback
- The Flutter architecture's `interview_session_screen.dart` is designed to be extended with camera input
- Planned: integrate AWS Rekognition for facial expression and eye-contact scoring as an additional dimension

### 5. Adaptive Difficulty Engine
- `interviewService.js` already tracks per-dimension running averages; these can drive a difficulty controller
- Planned: if `technicalVocabulary` score > 80, escalate to senior-level questions in the next turn

### 6. LLM Observability & Cost Dashboard
- `bedrock.js` already logs `inputTokens` / `outputTokens` per call
- Planned: aggregate token usage to DynamoDB and surface in an admin dashboard for cost attribution per user and module

---

## Contributing

1. Fork the repo and create a feature branch: `git checkout -b feature/my-feature`
2. Backend: add a unit test under `backend/tests/unit/` for any new Lambda handler
3. Frontend: add widget or provider tests under `frontend/test/`
4. Run `npm test` (backend) and `flutter test` (frontend) — all tests must pass
5. Open a pull request against `main`

---

## License

MIT © 2024 Qlue Team
