# Email verification with a code

Email/password accounts verify their mailbox with a six-digit code in the app.
Firebase still handles passwords, Google sign-in and all application sessions.
Accounts that are already verified keep their normal sign-in flow. This replaces
signup verification links; it does not add an OTP challenge to every login.

## Delivery without a domain or sender mailbox

The SAM template creates a separate Cognito pool using `COGNITO_DEFAULT` email
delivery. AWS sends the code from `no-reply@verificationemail.com`; the app owner
does not need a domain, mailbox, SES identity, or an SMTP password. The app client
has a generated secret which only backend roles can retrieve. No Cognito secret
or auxiliary password is sent to the Flutter app. Cognito tokens never authorize
the application's REST or WebSocket APIs.

[AWS managed email delivery](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
has a quota of **50 emails per AWS account per Region per day**, shared with other
pools. It resets at 09:00 UTC. The app defaults to 40 attempted sends in that same
window. This is appropriate for limited traffic; a larger launch needs a higher
volume email setup. See [AWS quotas](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html).

## Flow and protections

1. Registration creates a Firebase account. The client signs in to an unverified
   session, which is confined to the verification screen.
2. `/auth/send-otp` checks a real Firebase token with revocation checking, a login
   within the last 15 minutes, the current account email and deletion status.
   The destination and UID come from Firebase, never request-body fields.
3. DynamoDB atomically reserves the challenge and sending budgets. Cognito sends
   the code. A delivery error does not become a successful response.
4. `/auth/verify-otp` reserves an attempt and an exclusive verification lease,
   then asks Cognito to check the code. The application permits five minutes even
   though the provider's own confirmation-code lifetime is longer.
5. Only a successful provider confirmation can consume the matching challenge
   and mark that exact Firebase mailbox verified. The app reloads the user and
   forces a fresh ID token before opening protected pages.

Limits include five guesses per challenge, twenty guesses per user per hour,
one send per minute, five sends per user per hour, twenty sends per source IP
per hour and the global daily cap. Resending invalidates previous challenges.
Concurrent submissions cannot consume a challenge twice. Codes are never stored
in application DynamoDB records, logged, or returned by the API.

The verification endpoints bypass the normal API authorizer so an unverified
session can reach them, but explicitly verify their bearer token inside each
handler. All protected REST routes now reject unverified Firebase tokens.
The existing WebSocket verification gate remains. The unused client auth bypass
was removed, and signup/login errors now remain errors on the app screen.

Challenge state expires through DynamoDB TTL after a day; rate counters expire
after their windows. Account deletion also purges user-owned verification
counters rather than waiting for TTL. Auxiliary Cognito records are removed after successful
verification, before a new code is issued, and during account deletion. An
abandoned verification or a crash before cleanup can leave one auxiliary record
per Firebase UID; include old unconfirmed records in account-retention cleanup.

## Verification and rollout

Final checks: 459 backend tests in 66 suites, 191 Flutter tests, Flutter analysis
with no issues, SAM validation/lint, ten isolated AWS DynamoDB checks, and no
reported production dependency vulnerabilities. Production-layer package parity
passes with the new pure-JavaScript SDK. A fresh Linux ARM64 SAM build succeeded
for deployment. The largest function plus layers is 196,607,767 bytes, below the
project's 200 MiB bound. Packaged PDF parsing and native delivery inference pass.

Tests cover code expiry, resend rotation, replay, wrong-account challenges,
guess limits, concurrent sends/confirmations, deletion fencing, provider failures,
token refresh, route gating and honest signup error messages. The isolated
DynamoDB harness is `audit/email-otp-integration.cjs --aws-isolated`; it stubs
Firebase and the delivery provider and deletes its temporary tables.

`audit/email-otp-provider-smoke.cjs` tests a real temporary Cognito pool and
confidential client against a uniquely labelled AWS mailbox-simulator address.
AWS accepted managed-sender delivery and rejected an incorrect code. The pool
and client were removed. This verifies provider acceptance, not receipt in a
person's inbox or entry of a real received code.

Deploy the matching backend template/code and build the updated app together.
The new Cognito SDK is pinned in both backend and production-layer manifests.
No extra sender parameter or manually provisioned OTP signing secret is needed.
Existing unverified accounts can sign in and request a code; verified accounts
are not forced through verification again. Test a real inbox before public
rollout, and monitor delivery errors, rate limits and account-level quotas.

The backend was deployed to the existing `qlue-dev` stack on October 18, 2026.
The live API checks cover signup, rejection of unverified access, managed-sender
email acceptance, resend idempotency and rejection of an incorrect code. The
test used AWS's mailbox simulator and removed its synthetic Firebase, Cognito
and per-user DynamoDB records. Actual inbox receipt and entry of a received
correct code still need a real-device check.

Live testing found a missing `dynamodb:ConditionCheckItem` permission on
DeletionJobsTable for both OTP roles. The narrowly scoped permission is now in
the local SAM template and was deployed through a reviewed CloudFormation fix.
A regression check covers both roles.

The requested `noreply@qlueai.com` address and its domain are not verified in
this account's SES configuration. Delivery therefore uses Cognito's built-in
`no-reply@verificationemail.com` sender. A custom sender requires SES ownership
verification and Cognito sending authorization. The application cap remains
40 email attempts per day; increase capacity only with an appropriate sender
and account quota configuration.

The signed Android APK remains version 1.0.9 (10009), uses the existing release
certificate, and includes the current deployed API addresses and OTP routes.
It is built locally; no GitHub release asset was replaced by this deployment.

See the [deployment report](deployment-2026-10-18.md) for the migration,
live verification and artifact details.
