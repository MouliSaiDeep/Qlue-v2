# Interview quota policy

User requirement: **10 interviews per day per user, never a shared pool.**

Each authenticated account has its own atomic `interview` counter in UsageTable
under `{userId, date}`. The date is UTC; reset is midnight UTC (05:30 IST).
All interview modules share that account's ten daily slots. Starting a valid
interview reserves one slot. Failed initialization refunds it. Questions,
answers, speech recognition and automatic final feedback do not reserve extra
interview slots. Completing or abandoning an interview does not refund a
successfully started session. Concurrent initialization cannot pass the limit.

`QUOTA_FREE_INTERVIEWS` is explicitly 10 in the SAM template. Do not replace
this with a counter shared across accounts or count individual model requests
as interviews. No frontend change is required for this policy.

## Separate provider-call safeguards

The old `PAID_ATTEMPT_LIMIT=50` applied to every provider request from every
account plus operator tests. One multi-turn interview needs several requests;
that shared guard could block other users even when they had interview slots.

The local correction keeps three distinct controls:

- Interview admission: **10 sessions per account per UTC day**.
- Provider retry/loop protection: **500 attempts per account per UTC day**,
  configured with `USER_PAID_ATTEMPT_LIMIT`. This is not 500 interviews and
  does not change the ten-session quota. Normal eight-turn interviews use
  multiple model and speech requests; a test exercises ten interviews with
  170 provider attempts without denying an interview prematurely. Exhaustion
  affects only that account; provider failures/retries also count.
- Unowned system/operator calls: the existing 50-attempt daily guard remains
  on its separate legacy system row. It cannot block authenticated users.

The operational stop switch is retained. No existing daily counters are reset,
no global threshold is raised and no test identity is passed off as a user.
The provider guard is additional protection, not a promise of successful
service when a provider is unavailable or an account exhausts its own guard.

Authenticated provider counts are stored alongside that account's quotas so
account deletion removes them too. A deletion fence protects the counter write.
The interview worker binds paid work to the owner read from the session, keeping
the parent deadline intact. Supported authorizer identities at initialization
are handled consistently; a body-supplied userId cannot select the quota owner.
Denied provider admission does not trigger Bedrock retries or Polly fallbacks.

## Rollout status

**Deployed October 20, 2026**, together with the feedback rubric and gateway
per-user capture guard. No commit or GitHub push was made. The gateway now
allows 160 answer-capture starts per user per UTC day, including retries; its
old shared 20-start daily cap is removed. Four concurrent streams remain a
capacity limit. See [the release record](backend-release-2026-10-20.md).
Unit/integration checks use local AWS boundaries and do not spend model allowance.
Full backend verification: **72 suites, 540 tests passed**. Coverage includes
independent ten-session allowances, concurrent final-slot reservations,
cross-user/system counter isolation, ten multi-turn sessions, deletion fencing,
UTC-day boundaries and refusal before a provider request or retry is sent.
See the task's verification log at `tmp/per-user-quota-full-tests.log`.
