# OTP and event-driven backend deployment — October 18, 2026

The existing `qlue-dev` stack in `us-east-1` is deployed, active and in
`UPDATE_COMPLETE`. Processing is restored to `none` on the paid-operations stop
switch. The daily provider-attempt limit remains 50; the verification-email
attempt limit is 40. These are attempt limits, not hard limits on the AWS bill.

The six scheduled recovery rules are removed. Eight mappings are enabled: six
DynamoDB stream consumers, including the existing profile consumer, and the two
SQS consumers. The original interview queue has exactly one consumer, its
original interview worker. The new shared recovery queue has the lightweight
dispatcher as its consumer. Analysis, deletion, resume, feedback and session
tables all have NEW_AND_OLD_IMAGES streams.

Deployment used the owning stack, a reviewed paused migration and a reviewed
activation change set. Existing tables, buckets, queues, Lambda identities and
environment values were preserved. The old feedback profile consumer remained
enabled during the invocation drain; its processing status was healthy before
its stream descriptor changed. A consistent one-time inventory found no
unfinished recovery jobs to seed. No customer rows were rewritten or queues
purged for migration.

Live acceptance found that the OTP functions lacked ConditionCheckItem access
to the deletion fence. A reviewed follow-up changed only the two execution-role
policies, with unchanged Lambda/API definitions reported as dynamic
dependencies. The scoped fix is also in the local canonical SAM template, with
two regression tests. The final activation changed only eight mappings and the
processing switch.

Email confirmation now uses six-digit codes and Cognito's managed sender,
`no-reply@verificationemail.com`. Neither `noreply@qlueai.com` nor `qlueai.com`
is a verified SES identity in this account, and no Route53 hosted zone is
configured here for that domain. The custom address was therefore not enabled.
[AWS requires verification and sending authorization for a custom From address](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html).

Validation completed:

- 459 backend tests across 66 suites, 191 Flutter tests, Flutter analysis with
  no issues and SAM template lint passed. The production dependency audit
  reported no vulnerabilities during this work.
- A fresh Linux ARM64 SAM build passed package parity and credential/development
  dependency checks. All 7,200 JavaScript comparisons across 120 source files
  and 60 function directories match. The largest extracted function plus layers
  is 196,607,767 bytes, below the project's 200 MiB bound.
- Packaged ARM64 PDF parsing and native audio inference passed. The first PDF
  check exceeded its local emulation deadline while concurrent builds ran; a
  rerun after compilation completed passed without changing production code.
- The deployed API passed synthetic signup, unverified-login rejection,
  protected-API rejection, code-email acceptance, immediate resend idempotency
  and incorrect-code rejection. Firebase remained unverified after the wrong
  code. The unique synthetic Firebase/Cognito users and per-user DynamoDB
  records were removed; aggregate rate-limit counters expire normally.
- All 60 deployed functions are Active with Successful updates, Node.js 24 and
  ARM64, and share the expected application code hash. Six absent-key probes
  exercised the live recovery workers without customer changes. All six shared
  queue probes were forwarded successfully. The shared queue and six recovery
  dead-letter queues were empty at final verification.

The signed APK is
`frontend/build/releases/1.0.9-otp/Qlue-1.0.9-otp.apk`, version **1.0.9 (10009)**,
application ID `com.qlue.sloths1`, 79,156,633 bytes. It preserves the previous
release signing certificate and contains the deployed API addresses and both
OTP routes. SHA-256:

```text
967da4bbe1124b897c273455bc80b628ec143620dacc6f4d9581402f23c0804c
```

The email test recipient was AWS's mailbox simulator. Receipt in a real inbox,
entry of a received correct code and installation on a physical Android device
remain untested. This deployment did not publish or replace a GitHub release
asset. Workload-dependent cost savings require billing observation; real resume
quality and production-scale load were not benchmarked by these smoke tests.

Evidence is saved locally under `tmp/deploy-otp-2026-10-18/`, including the
reviewed change sets, source/package gates, final backend results, live OTP
smoke result, deployed-function verification, dispatcher logs, queue-drain
verification and APK signature/manifest inspection.
