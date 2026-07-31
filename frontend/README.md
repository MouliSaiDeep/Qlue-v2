# Qlue — AI-powered Interview Simulation

![Qlue Logo](https://via.placeholder.com/150)

**AI-powered interview simulation platform — practice smarter, perform better.**

[![Project Status: In Development](https://img.shields.io/badge/status-In%20Development-yellow.svg)](https://github.com/Rishi1435/Qlue-UI-Design)
[![Version: 2.0](https://img.shields.io/badge/version-2.0-blue.svg)](https://github.com/Rishi1435/Qlue-UI-Design)
[![Region: ap-south-1](https://img.shields.io/badge/AWS%20Region-ap--south--1-orange.svg)](https://aws.amazon.com/regions/)

---

## Overview

Qlue is an advanced AI-powered interview simulation mobile application designed to help job seekers excel in their career journeys. Leveraging AWS cloud-native architecture and NVIDIA-powered LLMs, Qlue provides realistic, real-time interview experiences across three specialized modules:

-   **RESUME**: Personalized AI interviews based on your uploaded resume data.
-   **WEBSITE (Adaptive Tutor)**: AI teaches concepts from any web URL and tests your comprehension in real-time.
-   **HR**: Behavioral interview simulations using industry-standard HR question templates.

The platform analyzes your speech, generates neural AI voices, and provides deep qualitative and quantitative feedback to help you improve.

---

## Tech Stack

### Frontend
| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Framework** | Flutter | Dart, cross-platform mobile (iOS + Android) |
| **State Management** | Provider / Riverpod | Team preference driven state orchestration |
| **Authentication** | Firebase Auth SDK | Email/Password + Google OAuth support |
| **Speech-to-Text** | Flutter STT plugin | On-device, real-time transcription |
| **Text-to-Speech** | AWS Polly (primary) | Neural voice streaming via WebSocket; Fallback: Flutter TTS plugin |
| **Real-time Comms** | WebSocket client | Connects to AWS API Gateway WebSocket API |
| **Push Notifications** | Firebase Cloud Messaging | Session feedback ready alerts |
| **HTTP Client** | Dio / http package | REST API calls to API Gateway |

### Backend
| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Compute** | AWS Lambda | Node.js 20.x runtime, all functions |
| **API Gateway (REST)** | AWS API Gateway v1 | All standard REST endpoints |
| **API Gateway (WS)** | AWS API Gateway WebSocket | Real-time interview session communication |
| **AI / LLM** | AWS Bedrock (NVIDIA Nemotron) | Question generation, scoring, feedback, concept extraction |
| **Text-to-Speech** | AWS Polly | Neural voice synthesis, streamed to client |
| **OCR / Document** | AWS Textract | Resume PDF/DOC parsing |
| **Object Storage** | AWS S3 | Resume files, scraped content, profile photos |
| **Database** | AWS DynamoDB | Multi-table design, PAY_PER_REQUEST mode |
| **Authentication** | Firebase Admin SDK | JWT validation via Lambda Authorizer |
| **Notifications** | Firebase Admin SDK (FCM) | Push notification delivery |
| **Event Bus** | AWS SNS | Session completion → feedback generation trigger |
| **Secrets** | AWS Secrets Manager | Firebase keys, Bedrock config, scraper API key |
| **Web Scraping** | scrape.do API | Website content fetching for Adaptive Tutor module |
| **Infrastructure** | AWS SAM | Serverless deployment templates |

---

## Architecture Overview

```text
Flutter App
    │
    ├── REST (HTTPS) ──► AWS API Gateway (REST) ──► Lambda Functions ──► DynamoDB / S3 / Bedrock
    │
    └── WebSocket ──────► AWS API Gateway (WebSocket) ──► Lambda Functions ──► DynamoDB / Polly / Bedrock
                                                                │
                                                                └── SNS ──► Feedback Lambda
```

### Interview Modules
-   **RESUME**: AI interviews user based on their uploaded resume.
-   **WEBSITE**: Adaptive Tutor - AI teaches concepts from a user-provided URL and tests comprehension.
-   **HR**: Behavioral interview using structured HR question templates.

---

## Frontend Folder Structure

```text
qlue_mobile/
├── android/                        # Android native project
├── ios/                            # iOS native project
├── lib/
│   ├── main.dart                   # App entry point
│   ├── app.dart                    # Root widget, theme, routing
│   │
│   ├── core/
│   │   ├── constants/
│   │   │   ├── api_constants.dart  # Base URLs, endpoint paths
│   │   │   └── app_constants.dart  # App-wide constants
│   │   ├── errors/
│   │   │   ├── exceptions.dart     # Custom exception classes
│   │   │   └── failures.dart       # Domain failure types
│   │   ├── network/
│   │   │   ├── dio_client.dart     # Dio HTTP client setup
│   │   │   └── websocket_client.dart # WebSocket connection manager
│   │   ├── utils/
│   │   │   ├── token_storage.dart  # Secure JWT storage
│   │   │   └── logger.dart         # App-wide logger
│   │   └── theme/
│   │       ├── app_theme.dart      # Light/dark theme definitions
│   │       └── app_colors.dart     # Color palette
│   │
│   ├── features/
│   │   ├── auth/
│   │   │   ├── data/
│   │   │   │   ├── auth_repository.dart
│   │   │   │   └── auth_remote_datasource.dart
│   │   │   ├── domain/
│   │   │   │   ├── models/user_model.dart
│   │   │   │   └── usecases/
│   │   │   └── presentation/
│   │   │       ├── screens/
│   │   │       │   ├── login_screen.dart
│   │   │       │   ├── register_screen.dart
│   │   │       │   └── forgot_password_screen.dart
│   │   │       └── providers/auth_provider.dart
│   │   │
│   │   ├── dashboard/
│   │   │   ├── data/dashboard_repository.dart
│   │   │   ├── domain/models/dashboard_model.dart
│   │   │   └── presentation/
│   │   │       ├── screens/sessions_screen.dart   # Home screen with radar chart
│   │   │       └── providers/dashboard_provider.dart
│   │   │
│   │   ├── history/
│   │   │   ├── data/history_repository.dart
│   │   │   ├── domain/models/session_model.dart
│   │   │   └── presentation/
│   │   │       ├── screens/history_screen.dart
│   │   │       └── providers/history_provider.dart
│   │   │
│   │   ├── modules/
│   │   │   └── presentation/
│   │   │       └── screens/ai_modules_screen.dart # Module selection (Resume/Website/HR)
│   │   │
│   │   ├── interview/
│   │   │   ├── data/interview_repository.dart
│   │   │   ├── domain/
│   │   │   │   ├── models/
│   │   │   │   │   ├── session_state.dart
│   │   │   │   │   └── transcript_model.dart
│   │   │   │   └── state_machine/interview_state_machine.dart
│   │   │   └── presentation/
│   │   │       ├── screens/interview_screen.dart
│   │   │       ├── widgets/
│   │   │       │   ├── waveform_widget.dart       # Audio input visualizer
│   │   │       │   └── transcript_bubble.dart
│   │   │       └── providers/interview_provider.dart
│   │   │
│   │   ├── resume/
│   │   │   ├── data/resume_repository.dart
│   │   │   ├── domain/models/resume_model.dart
│   │   │   └── presentation/
│   │   │       ├── screens/resume_management_screen.dart
│   │   │       └── providers/resume_provider.dart
│   │   │
│   │   ├── feedback/
│   │   │   ├── data/feedback_repository.dart
│   │   │   ├── domain/models/feedback_model.dart
│   │   │   └── presentation/
│   │   │       ├── screens/feedback_screen.dart
│   │   │       └── providers/feedback_provider.dart
│   │   │
│   │   └── profile/
│   │       ├── data/profile_repository.dart
│   │       ├── domain/models/profile_model.dart
│   │       └── presentation/
│   │           ├── screens/profile_screen.dart
│   │           └── providers/profile_provider.dart
│   │
│   └── shared/
│       ├── widgets/
│       │   ├── primary_button.dart
│       │   ├── loading_indicator.dart
│       │   ├── error_snackbar.dart
│       │   └── radar_chart_widget.dart       # Performance radar (6 axes)
│       └── services/
│           ├── stt_service.dart              # Flutter STT wrapper
│           ├── tts_service.dart              # Flutter TTS fallback
│           └── notification_service.dart    # FCM handler
│
├── assets/
│   ├── images/
│   └── fonts/
├── pubspec.yaml
└── README.md
```

---

## Backend Folder Structure

```text
qlue-backend/
├── template.yaml                          # AWS SAM deployment template
├── package.json                           # Root dev dependencies
├── .env.example                           # Environment variable template
│
├── src/
│   ├── handlers/
│   │   │
│   │   ├── auth/                          # Auth Handler Group
│   │   │   ├── validateToken.js           # Lambda Authorizer (JWT verification)
│   │   │   ├── registerUser.js            # POST /auth/register
│   │   │   ├── loginUser.js               # POST /auth/login
│   │   │   ├── loginWithGoogle.js         # POST /auth/google
│   │   │   ├── refreshToken.js            # POST /auth/refresh
│   │   │   ├── logoutUser.js              # POST /auth/logout
│   │   │   ├── deleteAccount.js           # DELETE /auth/account
│   │   │   ├── getUserProfile.js          # GET /auth/profile
│   │   │   └── updateUserProfile.js       # PUT /auth/profile, PUT /auth/fcm-token
│   │   │
│   │   ├── resume/                        # Resume Processing Group
│   │   │   ├── generatePresignedUrl.js    # POST /resumes/upload-url
│   │   │   ├── processResumeUpload.js     # S3 trigger (ObjectCreated)
│   │   │   ├── getResumeList.js           # GET /resumes
│   │   │   ├── getResumeDetail.js         # GET /resumes/{resumeId}
│   │   │   ├── updateResumeParsedData.js  # PUT /resumes/{resumeId}
│   │   │   ├── deleteResume.js            # DELETE /resumes/{resumeId}
│   │   │   ├── setActiveResume.js         # PUT /resumes/{resumeId}/active
│   │   │   └── validateResumeHash.js      # POST /resumes/validate-hash
│   │   │
│   │   ├── interview/                     # Interview Orchestration Group
│   │   │   ├── initializeSession.js       # POST /interview/init
│   │   │   ├── processUserInput.js        # WebSocket sendText route (internal)
│   │   │   ├── generateQuestion.js        # Internal: Bedrock question generation
│   │   │   ├── manageContextWindow.js     # Internal: LLM context truncation
│   │   │   ├── controlTurnFlow.js         # Internal: State machine transitions
│   │   │   ├── synthesizeSpeech.js        # Internal: AWS Polly TTS streaming
│   │   │   └── terminateSession.js        # Internal: Session end + SNS publish
│   │   │
│   │   ├── websocket/                     # WebSocket Handlers Group
│   │   │   ├── connectHandler.js          # $connect route
│   │   │   ├── disconnectHandler.js       # $disconnect route
│   │   │   ├── sendTextHandler.js         # $default route (message router)
│   │   │   ├── stateUpdateHandler.js      # Internal: push state updates to client
│   │   │   └── errorHandler.js            # Internal: push error messages to client
│   │   │
│   │   ├── feedback/                      # Feedback & Scoring Group
│   │   │   ├── triggerFeedbackGeneration.js  # SNS trigger → orchestrates scoring
│   │   │   ├── analyzeTranscript.js          # Internal: Bedrock transcript analysis
│   │   │   ├── computeModuleScores.js        # Internal: weighted score calculation
│   │   │   ├── generateFeedbackReport.js     # Internal: qualitative feedback via Bedrock
│   │   │   ├── storeFeedbackReport.js        # Internal: DynamoDB PutItem to Feedback
│   │   │   └── sendFeedbackNotification.js   # Internal: FCM push notification
│   │   │
│   │   ├── dashboard/                     # Dashboard & Analytics Group
│   │   │   ├── getDashboardSummary.js     # GET /dashboard/summary
│   │   │   ├── getScoreTrends.js          # GET /dashboard/trends
│   │   │   ├── getModuleStats.js          # GET /dashboard/module-stats
│   │   │   ├── getSessionHistory.js       # GET /sessions
│   │   │   ├── getSessionDetail.js        # GET /sessions/{sessionId}
│   │   │   └── getTranscript.js           # GET /sessions/{sessionId}/transcript
│   │   │
│   │   └── scraper/                       # Scraper Group
│   │       └── fetchAndCleanContent.js    # POST /scraper/fetch
│   │
│   ├── lib/                               # Shared utilities
│   │   ├── dynamodb.js                    # DynamoDB DocumentClient wrapper
│   │   ├── bedrock.js                     # Bedrock InvokeModel wrapper
│   │   ├── firebase.js                    # Firebase Admin SDK init
│   │   ├── polly.js                       # Polly streaming helper
│   │   ├── s3.js                          # S3 presigned URL + operations
│   │   ├── sns.js                         # SNS publish helper
│   │   ├── secrets.js                     # Secrets Manager cache
│   │   ├── response.js                    # Standard HTTP response builder
│   │   └── errors.js                      # Error code constants
│   │
│   └── models/                            # DynamoDB item shape definitions
│       ├── user.js
│       ├── resume.js
│       ├── session.js
│       ├── transcript.js
│       ├── feedback.js
│       ├── conceptState.js
│       └── wsConnection.js
│
└── tests/
    ├── unit/
    └── integration/
```

---

## DynamoDB Tables

| Table | PK | SK | Purpose |
| :--- | :--- | :--- | :--- |
| **Users** | `userId` (S) | — | User profiles, auth metadata, preferences |
| **Resumes** | `userId` (S) | `resumeId` (S) | Resume files, parse status, extracted data |
| **Sessions** | `userId` (S) | `sessionId` (S) | Interview session state and metadata |
| **Transcripts** | `sessionId` (S) | `turnIndex` (N) | Turn-by-turn conversation text (no audio stored) |
| **Feedback** | `sessionId` (S) | — | Post-session scoring reports |
| **ConceptStates** | `sessionId` (S) | `conceptId` (S) | Website module concept learning progress |
| **WSConnections** | `connectionId` (S) | — | Active WS connections (TTL: 2 hours) |
| **Notifications**| `userId` (S) | — | User notification preferences |

### Global Secondary Indexes (GSIs)
-   **Users.GSI_Email**: lookup by email.
-   **Sessions.GSI_SessionId**: direct lookup by sessionId.
-   **Sessions.GSI_ActiveSession**: sparse index: find active session per user.
-   **Feedback.GSI_UserFeedback**: list all feedback for a user sorted by date.

### Module Scoring Dimensions
-   **RESUME**: clarity, fluency, vocabulary, useOfExamples.
-   **WEBSITE**: clarity, fluency, vocabulary, comprehensionAccuracy, learningProgression.
-   **HR**: clarity, fluency, vocabulary, teamwork, ethicalThinking.

---

## REST API Endpoints

**Base URL**: `https://api.qlue.com/v1`
**Auth**: `Authorization: Bearer <firebase_jwt>` (Required for all except initial auth)

### Auth Endpoints

#### POST /auth/register
Register a new user with email and password.
**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "displayName": "John Doe"
}
```
**Response 201:**
```json
{
  "userId": "usr-a1b2c3d4-...",
  "email": "user@example.com",
  "displayName": "John Doe",
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "refresh-token-abc123...",
  "expiresIn": 3600
}
```
*Errors: EMAIL_EXISTS (409), INVALID_EMAIL (400), WEAK_PASSWORD (400), INVALID_DISPLAY_NAME (400)*

#### POST /auth/google
Authenticate via Google OAuth.
**Request:**
```json
{ "idToken": "eyJhbGciOiJSUzI1NiIs..." }
```
**Response 200:**
```json
{
  "userId": "usr-a1b2c3d4-...",
  "email": "user@gmail.com",
  "displayName": "John Doe",
  "photoUrl": "https://lh3.googleusercontent.com/...",
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "refresh-token-abc123...",
  "expiresIn": 3600,
  "isNewUser": false
}
```

#### POST /auth/login
**Request:**
```json
{ "email": "user@example.com", "password": "SecurePass123!" }
```
**Response 200:**
```json
{
  "userId": "usr-a1b2c3d4-...",
  "email": "user@example.com",
  "displayName": "John Doe",
  "photoUrl": "https://...",
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "refresh-token-abc123...",
  "expiresIn": 3600
}
```

#### POST /auth/refresh
**Request:**
```json
{ "refreshToken": "refresh-token-abc123..." }
```
**Response 200:**
```json
{ "accessToken": "eyJhbGci...", "refreshToken": "new-refresh-...", "expiresIn": 3600 }
```

#### POST /auth/logout
**Response 200:**
```json
{ "message": "Logged out successfully" }
```

#### GET /auth/profile
**Response 200:**
```json
{
  "userId": "usr-a1b2c3d4-...",
  "email": "user@example.com",
  "displayName": "John Doe",
  "photoUrl": "https://...",
  "authProvider": "EMAIL_PASSWORD",
  "activeResumeId": "res-12345678-...",
  "preferences": { "notifications": true, "language": "en" },
  "createdAt": 1712275200000,
  "stats": { "totalSessions": 12, "averageScore": 7.8, "bestScore": 9.2 }
}
```

#### PUT /auth/profile
**Request:**
```json
{
  "displayName": "John Updated",
  "preferences": { "notifications": false }
}
```
**Response 200:**
```json
{ "displayName": "John Updated", "updatedAt": 1712361600000 }
```

#### PUT /auth/fcm-token
**Request:**
```json
{ "fcmToken": "fcm-registration-token-xyz789" }
```
**Response 200:**
```json
{ "message": "FCM token updated successfully" }
```

#### POST /auth/password-reset
**Request:**
```json
{ "email": "user@example.com" }
```
**Response 200:**
```json
{ "message": "Password reset email sent" }
```

#### DELETE /auth/account
**Response 200:**
```json
{
  "message": "Account deleted successfully",
  "deletedResources": { "resumes": 3, "sessions": 12, "feedback": 12 }
}
```

---

### Resume Endpoints

#### POST /resumes/upload-url
**Request:**
```json
{
  "fileName": "John_Doe_Resume.pdf",
  "fileSize": 245760,
  "fileHash": "sha256-abc123..."
}
```
**Response 200:**
```json
{
  "uploadUrl": "https://qlue-resumes.s3.ap-south-1.amazonaws.com/resumes/usr-abc.../resume.pdf?X-Amz-...",
  "resumeId": "res-12345678-...",
  "s3Key": "resumes/usr-abc.../1712275200000_resume.pdf",
  "expiresIn": 900
}
```
*Errors: RESUME_LIMIT_EXCEEDED (409), DUPLICATE_RESUME (409), INVALID_FILE_TYPE (400), FILE_TOO_LARGE (400)*

#### GET /resumes
**Response 200:**
```json
{
  "resumes": [{
    "resumeId": "res-12345678-...",
    "fileName": "John_Doe_Resume.pdf",
    "fileSize": 245760,
    "status": "PARSED",
    "uploadedAt": 1712275200000,
    "parsedAt": 1712275205000,
    "isActive": true
  }],
  "count": 1,
  "maxAllowed": 4
}
```

#### GET /resumes/{resumeId}
**Response 200:**
```json
{
  "resumeId": "res-12345678-...",
  "userId": "usr-abc...",
  "fileName": "John_Doe_Resume.pdf",
  "fileSize": 245760,
  "status": "PARSED",
  "parsedData": {
    "name": "John Doe",
    "contact": { "email": "john@example.com", "phone": "+91-9876543210", "location": "Mumbai, India" },
    "skills": ["Python", "AWS", "Flutter"],
    "workExperience": [{ "company": "Tech Corp", "role": "Senior Developer", "duration": "2021-2024" }],
    "projects": [{ "name": "ML Pipeline", "technologies": ["Python", "Airflow"] }],
    "education": [{ "institution": "IIT Bombay", "degree": "B.Tech CS", "year": "2020" }],
    "certifications": [{ "name": "AWS Solutions Architect", "issuer": "Amazon", "year": "2023" }]
  },
  "uploadedAt": 1712275200000,
  "parsedAt": 1712275205000,
  "isActive": true
}
```

#### PUT /resumes/{resumeId}
**Request:**
```json
{ "parsedData": { "skills": ["Python", "AWS", "Docker", "Kubernetes"] } }
```
**Response 200:**
```json
{
  "resumeId": "res-12345678-...",
  "parsedData": { "skills": ["Python", "AWS", "Docker", "Kubernetes"] },
  "updatedAt": 1712361600000
}
```

#### DELETE /resumes/{resumeId}
**Response 200:**
```json
{ "message": "Resume deleted successfully" }
```

#### PUT /resumes/{resumeId}/active
**Response 200:**
```json
{ "message": "Active resume updated successfully" }
```

#### POST /resumes/validate-hash
**Request:**
```json
{ "fileHash": "sha256-abc123..." }
```
**Response 200 (no duplicate):**
```json
{ "isDuplicate": false, "existingResumeId": null }
```
**Response 200 (duplicate found):**
```json
{
  "isDuplicate": true,
  "existingResumeId": "res-existing-uuid",
  "existingFileName": "Previous_Resume.pdf",
  "uploadedAt": 1712000000000
}
```

---

### Interview Endpoint

#### POST /interview/init
**Request:**
```json
{
  "moduleType": "RESUME",
  "contextRef": "res-12345678-..."
}
```
**Response 200:**
```json
{
  "sessionId": "sess-abc123-xyz789",
  "moduleType": "RESUME",
  "websocketUrl": "wss://ws.qlue.com/prod?token=eyJ...",
  "status": "INITIALIZING",
  "expiresIn": 300
}
```
*Errors: ACTIVE_SESSION_EXISTS (409), RESUME_NOT_PARSED (400), INVALID_MODULE_TYPE (400)*

---

### Session Endpoints

#### GET /sessions
**Response 200:**
```json
{
  "sessions": [{
    "sessionId": "sess-abc123-xyz789",
    "moduleType": "RESUME",
    "status": "TERMINATED",
    "duration": 720,
    "questionCount": 12,
    "createdAt": 1712275200000,
    "completedAt": 1712275920000,
    "hasFeedback": true,
    "overallScore": 7.8
  }],
  "nextCursor": "eyJ...",
  "hasMore": true
}
```

#### GET /sessions/{sessionId}
**Response 200:**
```json
{
  "sessionId": "sess-abc123-xyz789",
  "moduleType": "RESUME",
  "status": "TERMINATED",
  "terminationReason": "TIME_LIMIT",
  "duration": 720,
  "questionCount": 12,
  "contextRef": "res-12345678-...",
  "createdAt": 1712275200000,
  "completedAt": 1712275920000
}
```

#### GET /sessions/{sessionId}/transcript
**Response 200:**
```json
{
  "sessionId": "sess-abc123-xyz789",
  "turns": [
    { "turnIndex": 0, "role": "AI", "text": "Tell me about your most recent project.", "timestamp": 1712275210000 },
    { "turnIndex": 1, "role": "USER", "text": "I worked on an ML pipeline using Airflow...", "timestamp": 1712275230000 }
  ],
  "count": 24
}
```

---

### Feedback Endpoint

#### GET /feedback/{sessionId}
**Response 200:**
```json
{
  "sessionId": "sess-abc123-xyz789",
  "userId": "usr-abc...",
  "overallScore": 7.8,
  "dimensionScores": {
    "clarity": 8.0,
    "fluency": 7.5,
    "vocabulary": 8.0,
    "useOfExamples": 7.5
  },
  "strengths": [
    "Clear articulation of technical concepts",
    "Strong use of specific examples",
    "Good pace and delivery"
  ],
  "weaknesses": [
    "Could elaborate more on impact",
    "Some filler words detected",
    "Limited vocabulary variety"
  ],
  "recommendations": [
    "Practice quantifying your achievements",
    "Record yourself to identify filler words",
    "Expand technical vocabulary"
  ],
  "executiveSummary": "Strong interview performance with clear communication. Focus on quantifying achievements and expanding vocabulary for improvement.",
  "sessionMetadata": {
    "duration": 720,
    "questionCount": 12,
    "moduleType": "RESUME"
  },
  "generatedAt": 1712276000000
}
```

---

## Dashboard Endpoints

#### GET /dashboard/summary
**Response 200:**
```json
{
  "totalSessions": 25,
  "averageScore": 7.6,
  "bestScore": 9.2,
  "bestSessionId": "sess-best-uuid",
  "totalPracticeTime": 18000,
  "averageSessionDuration": 720,
  "timePerModule": {
    "RESUME": 7200,
    "WEBSITE": 5400,
    "HR": 5400
  },
  "moduleBreakdown": {
    "RESUME": { "count": 10, "avgScore": 7.8 },
    "WEBSITE": { "count": 8, "avgScore": 7.4 },
    "HR": { "count": 7, "avgScore": 7.6 }
  },
  "recentTrend": "IMPROVING",
  "lastSessionAt": 1712275920000
}
```

#### GET /dashboard/trends
**Response 200:**
```json
{
  "overall": [
    { "date": 1712275200000, "score": 7.2 },
    { "date": 1712361600000, "score": 7.8 }
  ],
  "byDimension": {
    "clarity": [{ "date": 1712275200000, "score": 7.5 }],
    "fluency": [{ "date": 1712275200000, "score": 7.0 }]
  },
  "improvementRate": "+0.6 pts over last 30 days"
}
```

#### GET /dashboard/module-stats
**Response 200:**
```json
{
  "modules": {
    "RESUME": {
      "totalSessions": 10,
      "averageScore": 7.8,
      "averageDuration": 720,
      "bestScore": 9.2,
      "dimensionAverages": {
        "clarity": 8.0,
        "fluency": 7.5,
        "vocabulary": 7.8,
        "useOfExamples": 7.9
      }
    },
    "WEBSITE": {
      "totalSessions": 8,
      "averageScore": 7.4,
      "averageDuration": 850,
      "bestScore": 8.9,
      "dimensionAverages": {
        "clarity": 7.5,
        "fluency": 7.2,
        "vocabulary": 7.6,
        "comprehensionAccuracy": 7.4,
        "learningProgression": 7.3
      }
    },
    "HR": {
      "totalSessions": 7,
      "averageScore": 7.6,
      "averageDuration": 680,
      "bestScore": 8.7,
      "dimensionAverages": {
        "clarity": 7.8,
        "fluency": 7.5,
        "vocabulary": 7.6,
        "teamwork": 7.4,
        "ethicalThinking": 7.7
      }
    }
  }
}
```

---

### Scraper Endpoint

#### POST /scraper/fetch
**Request:**
```json
{ "url": "https://example.com/article" }
```
**Response 200:**
```json
{
  "scrapeId": "scrape-uuid",
  "url": "https://example.com/article",
  "contentLength": 5432,
  "s3Key": "scraped/usr-abc/scrape-uuid.json",
  "conceptCount": 5
}
```
*Errors: URL_UNREACHABLE (502), ACCESS_FORBIDDEN (403), CONTENT_TOO_SHORT (400), INVALID_URL (400)*

---

## WebSocket API

**WS URL**: `wss://ws.qlue.com/prod?token=<firebase_jwt>`
All messages use JSON envelope: `{ "type": "...", "timestamp": 1712275200000, "payload": { ... } }`

### Client → Server Messages

#### session_init
```json
{
  "type": "session_init",
  "timestamp": 1712275200000,
  "payload": { "sessionId": "sess-abc123-xyz789" }
}
```

#### text_transcript
```json
{
  "type": "text_transcript",
  "timestamp": 1712275230000,
  "payload": {
    "sessionId": "sess-abc123-xyz789",
    "text": "I have three years of experience building distributed systems...",
    "turnIndex": 2
  }
}
```

#### heartbeat
```json
{
  "type": "heartbeat",
  "timestamp": 1712275260000,
  "payload": {}
}
```

#### session_resume
```json
{
  "type": "session_resume",
  "timestamp": 1712275300000,
  "payload": { "sessionId": "sess-abc123-xyz789", "lastTurnIndex": 4 }
}
```

### Server → Client Messages

#### tts_audio_chunk
```json
{
  "type": "tts_audio_chunk",
  "timestamp": 1712275215000,
  "payload": {
    "sessionId": "sess-abc123-xyz789",
    "chunkIndex": 0,
    "isLast": false,
    "audioData": "<base64-encoded-pcm-chunk>"
  }
}
```

#### session_state_update
```json
{
  "type": "session_state_update",
  "timestamp": 1712275220000,
  "payload": {
    "sessionId": "sess-abc123-xyz789",
    "previousState": "AI_SPEAKING",
    "currentState": "USER_RESPONDING",
    "turnIndex": 2,
    "questionText": "Tell me about a challenging project you led."
  }
}
```

#### termination
```json
{
  "type": "termination",
  "timestamp": 1712275920000,
  "payload": {
    "sessionId": "sess-abc123-xyz789",
    "reason": "TIME_LIMIT",
    "duration": 720,
    "questionCount": 12,
    "message": "Great session! Your feedback report is being generated and will be ready shortly."
  }
}
```

#### error
```json
{
  "type": "error",
  "timestamp": 1712275500000,
  "payload": {
    "errorCode": "BEDROCK_TIMEOUT",
    "message": "Let me think about that for a moment...",
    "recoverable": true,
    "suggestedAction": "RETRY"
  }
}
```

---

## Environment Variables & Secrets

### Lambda Environment Variables
```text
# AWS Configuration
AWS_REGION=ap-south-1
DYNAMODB_USERS_TABLE=qlue-users
DYNAMODB_RESUMES_TABLE=qlue-resumes
DYNAMODB_SESSIONS_TABLE=qlue-sessions
DYNAMODB_TRANSCRIPTS_TABLE=qlue-transcripts
DYNAMODB_FEEDBACK_TABLE=qlue-feedback
DYNAMODB_CONCEPT_STATES_TABLE=qlue-concept-states
DYNAMODB_WS_CONNECTIONS_TABLE=qlue-ws-connections
DYNAMODB_NOTIFICATIONS_TABLE=qlue-notifications

S3_RESUMES_BUCKET=qlue-resumes
S3_SCRAPED_BUCKET=qlue-scraped-content

SNS_FEEDBACK_TOPIC_ARN=arn:aws:sns:ap-south-1:123456789:qlue-feedback-trigger

WEBSOCKET_API_ENDPOINT=https://ws.qlue.com/prod

# Bedrock
BEDROCK_MODEL_ID=amazon.titan-nemotron-...
BEDROCK_MAX_TOKENS=4096

# Polly
POLLY_VOICE_ID=Joanna
POLLY_ENGINE=neural
```

### AWS Secrets Manager Secrets
| Secret Name | Contents |
| :--- | :--- |
| **qlue/firebase-service-account** | Firebase Admin SDK private key JSON |
| **qlue/bedrock-config** | Model ID, region, max tokens |
| **qlue/scraper-api-key** | scrape.do API key |
| **qlue/fcm-server-key** | Firebase Cloud Messaging server key |

### Flutter .env
```text
API_BASE_URL=https://api.qlue.com/v1
WEBSOCKET_URL=wss://ws.qlue.com/prod
FIREBASE_PROJECT_ID=qlue-app
FIREBASE_API_KEY=AIza...
FIREBASE_APP_ID=1:123456789:android:abc123
```

---

## Local Setup & Run

### Prerequisites
-   Flutter SDK 3.x
-   Node.js 20.x
-   AWS CLI v2 (configured with IAM credentials)
-   AWS SAM CLI
-   Firebase CLI

### Frontend Setup
```bash
# Navigate to mobile project
cd qlue_mobile

# Install dependencies
flutter pub get

# Copy env file and fill values
cp .env.example .env

# Run on connected device
flutter run
```

### Backend Setup
```bash
# Navigate to backend
cd qlue-backend

# Install dependencies
npm install

# Build and deploy with SAM
sam build
sam deploy --guided

# Local testing
sam local start-api --env-vars env.json
```

---

## Key Constraints & Business Rules

| Rule | Constraint |
| :--- | :--- |
| **Max resumes per user** | 4 |
| **Max resume file size** | 5 MB |
| **Supported formats** | PDF, DOC, DOCX |
| **Session duration** | 10–15 minutes (AI-controlled termination) |
| **Silence retry limit** | 3 retries × 10-s intervals before termination |
| **Audio storage** | ❌ **NONE**. Transcripts only. |
| **Language support** | English only (Speech processing) |
| **WebSocket TTL** | 2 hours (API Gateway max) |
| **DynamoDB capacity** | PAY_PER_REQUEST (on-demand) |
| **Concurrent sessions** | 1 active session per user at any time |
| **Feedback generation** | Asynchronous via SNS after session end |
| **Concept difficulty** | Starts INTERMEDIATE, adapts based on performance |
| **Textract minimum text**| ≥ 50 words + section keyword |
| **Scraper min content** | ≥ 200 characters after cleaning |

---

**© 2026 Qlue Development Team. All rights reserved.**
