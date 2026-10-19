# Account deletion

Profile → Delete Account opens an explicit, irreversible confirmation dialog.
Password accounts must enter their current password and type `DELETE`. Google
accounts must type `DELETE` and confirm the same Google identity. The email
verification screen also offers deletion, so an unverified signup is not trapped.

The client reauthenticates with Firebase and submits a fresh ID token to
`DELETE /auth/account`. The server verifies the token signature, revocation and
an `auth_time` within five minutes. It uses only the signed UID. A UID supplied
in the body or an authorizer context cannot choose another account.

The API first persists a permanent deletion job, which also fences app writes.
It then attempts Firebase Auth removal immediately and disables owned socket
rows. HTTP 202 means the durable request was accepted; `identityDeleted` reports
whether Firebase removal was confirmed. An identity failure is honestly pending,
not reported as a completed deletion. The DynamoDB stream and shared recovery
queue let the worker remove Firebase even if the client or API stops after the
job is persisted.

The worker waits 20 minutes before its final storage sweep, allowing existing
15-minute upload URLs and short in-flight work to expire. It removes owned
resumes, interviews, transcripts, submission receipts, concept states, feedback,
notifications, usage, support tickets, analysis jobs, WebSocket rows, uploaded
job descriptions, recordings and synthesized audio. All enumerated S3 versions
and delete markers are removed. The auxiliary Cognito email-verification user
and per-user OTP state/counters are removed too. The Firebase Auth user and AWS
profile must both be absent before the job is marked COMPLETE.

Retries resume from category checkpoints and use an exclusive worker lease.
Exhausted async Lambda/stream failures are retained in the existing deletion
DLQ; operators must inspect and redrive these failures. Completion is not
guaranteed within exactly 20 minutes if AWS/Firebase is unavailable. The minimal
UID deletion job remains as a fence against old work recreating data. This is
not erasure of historic provider logs or backups, which retain their configured
expiry. The app does not use Firebase Firestore or Realtime Database.

A late feedback aggregation skips deleted accounts and atomically checks the
deletion fence when saving insights; it cannot upsert a deleted profile.
The Flutter app discards account-owned providers, routes, sockets and timers
on UID transitions and clears profile caches. An account switch racing deletion
cannot delete or sign out the newly selected account.

Once Firebase removal succeeds, the same email may sign up again with a fresh
Firebase UID. Cleanup for the old UID does not affect that new account. Google
account deletion here removes the app's Firebase identity, not the person's
Google account.

## Validation and rollout

Evidence is stored in `tmp/account-deletion/` and the adjacent
`tmp/account-deletion-*.txt` logs. The scoped CloudFormation change set updates
only the deletion API, deletion worker and late-feedback profile handler, adds
the API's queue send permission, and refreshes the API deployment. Live layer,
database, bucket, queue and unrelated function definitions are reused.

`audit/account-deletion-live-smoke.cjs` creates uniquely named synthetic accounts
and scoped data fixtures. It never logs passwords, tokens or credentials. Only
its synthetic job drain deadlines are expedited for the storage-purge check;
the production 20-minute drain remains in place. Personal accounts are not used
or deleted in testing. Physical-device password/Google confirmation remains a
separate device acceptance step.

The scoped deployment completed on 18 October 2026. All 476 backend tests and
230 Flutter tests pass; Flutter analysis and SAM lint pass. The live harness
passed 13 checks, including same-email signup, old-token rejection, all seeded
owned rows and historical S3 versions, auxiliary identity removal, late-event
fencing, unverified self-deletion, and recovery after client interruption.
Synthetic fixtures were removed. Live verification confirms three updated
functions, 57 unchanged functions, all eight mappings enabled and seven empty
DLQs.

The signed APK is
`frontend/build/releases/1.0.9-account-deletion/Qlue-1.0.9-account-deletion.apk`,
version 1.0.9 (10009), package `com.qlue.sloths1`. Its SHA-256 is
`def578086569520d7f6f255987fbc0bf8cb1822d121b1ed101b551c974cf1914`.
The existing signing certificate is retained. Archive, architecture, font,
embedded flow/configuration and release packaging checks pass. It has not been
installed on a physical device or published to GitHub.
