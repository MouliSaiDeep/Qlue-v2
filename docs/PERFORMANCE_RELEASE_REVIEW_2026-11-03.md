# Performance release review — 3 November 2026

Review baseline: `8d326fc9cc9ac163c3f43be42d96a880c8d63518`.
This review covers the complete tracked diff and the new performance source/test
files that Git diff omits until tracked. Historical unrelated workspace changes
were reviewed and retained. No deployment, AWS provisioning, paid provider test,
installation, publication, or push was performed.

## Release decision

The confirmed runtime defects listed below are fixed and automated verification
passes. Publication remains conditional on a reviewed source commit including
the currently untracked files, a new release version/build number, and device
acceptance. This working directory is not a clean, publishable release revision.
Android release build, signature and app-owned native tests also pass locally,
as recorded below.

## Critical issues found and fixed

### R1 — Resume work could continue after sign-out / provider disposal

`frontend/lib/context/resume_provider.dart`: an upload waiting for hash validation
could continue to create a presigned upload after its account-owned provider was
disposed. Each new HTTP operation captures the then-current login, so continuing
old multi-step work is unsafe during sign-out/account replacement. Calls to
delete/set-active on a disposed provider also started requests.

Added disposal guards before mutation entry and after asynchronous upload stages;
disposed providers stop without starting the next operation. Existing Dio login
ownership/cancellation and account-keyed Provider reconstruction are unchanged.
No accepted backend mutation is rolled back or automatically repeated. The S3
upload's temporary Dio client is now closed after its response/error.

Mock proof: pause hash validation, dispose the provider, complete validation;
there is no presign request. Disposed delete/set-active entry points issue no
requests. Existing account-isolation and Dio ownership tests also pass. This
continuation weakness predates the optimization; it was confirmed in the touched
resume workflow rather than attributed solely to the recent diff.

### R2 — Tab-shell teardown threw and could leave refresh running

`frontend/lib/screens/tabs/tabs_screen.dart`: `context.read` in `dispose` throws
"Looking up a deactivated widget's ancestor is unsafe". When the account-owned
provider stays mounted outside the shell, this prevents its refresh timer from
being stopped. This was also present in the starting revision.

Cache the owning provider while the shell is active and use that reference for
teardown. A real GoRouter widget test cycles Practice/History three times and
leaves for Login. It now exits without an exception, stops refresh, and makes
only the initial summary request because rapid navigation remains throttled.

## Moderate issues found and fixed

| ID | Reproduction | Fix / evidence |
|---|---|---|
| R3 | Start a detail read; set active resume and refresh; complete the older detail | Mutation read epoch and list-snapshot guards prevent the old response undoing newer state |
| R4 | Start detail; load a newer list; finish detail last | A late detail result/error cannot overwrite the new list or its error state; pollers receive the current cached row |
| R5 | Old detail exists across mutation; start fresh detail; finish old one first | Invalidate pending-read sharing after a successful mutation; identity-check cleanup so the old future cannot evict the new one |
| R6 | List GET and mutation overlap; GET completes while mutation is pending | Count overlapping loading operations so the first completion cannot incorrectly clear loading |
| R7 | Load full history; existing dashboard refresh receives new sessions or updated scores | Merge only its already-requested recent rows into history, retaining older rows, module membership, date ordering, and the existing 100-row cap; no new query |
| R8 | Slow full-history response completes after a newer recent response | Preserve recent updates received during the full read; a subsequently initiated explicit full read remains authoritative |
| R9 | HR read pending; INTRO fails; rejoin HR | Notify listeners when returning to the pending selection, clearing the obsolete filter error immediately |

The first focused review run reproduced eight failures (R1 and R3–R9 scenarios,
some sharing a root cause); the separate navigation test reproduced R2. Each
passed after its fix. Two additional merge tests cover module filtering, the
100-row bound, reversed response order and authoritative subsequent full reads.
No speculative refactor or additional performance feature was introduced.

## Safe changes retained

- Separate dashboard recent activity and full history state, shared read futures,
  initial loading/error/empty handling, explicit Retry, static accessible loading
  placeholders, narrow subscriptions, cached sort and stable list keys.
- Particle rendering through a paint notifier, shared rotation calculations,
  reused paint, reduced-motion updates and complete controller/notifier disposal.
  Repeated mount/drag/tick/unmount tests leave no transient ticker callbacks.
- Removing the timer that repeatedly selected the same initialization message
  retains the actual message. Microphone readiness remains observed.
- DPR-aware image decode widths retain the original asset files and display
  dimensions; no visual asset replacement or new dependency.
- DynamoDB projections contain every field consumed by module stats/trends,
  including score selection, filtering and both date representations. The
  existing GSI projects ALL, so no new index or table fetch is needed. Tests
  actually return projected fields, exercise continuation pages, keep genuine
  zero scores, reject unauthorized access and retain exclusion rules.
- No changes to interview answer IDs, acknowledgements, receipt lookup,
  accepted-answer persistence, voice quality, model selection, evaluation logic,
  authentication contracts, quota gates, provider deadlines or worker leases.

## Complete diff and cost review

In addition to the performance files, the tracked baseline diff includes:

- `.github/workflows/deploy.yml`: backend verification snapshot, test/coverage
  evidence and artifact retention. No AWS role assumption or automatic deployment
  was added; paid audit scripts are not executed by these new steps.
- `audit/release-manifest.cjs`: additional audit tools included in source hashing;
  naming a script does not execute it or its cloud operations.
- `docs/BACKEND_IMPROVEMENT_PLAN_2026-10-22.md`, `FEEDBACK_EVALUATION.md`,
  `OPERATIONS.md`: historical backend work and deployment/testing procedures.
  Their older frontend-freeze wording does not describe this new authorized
  frontend change. References to existing billable alarm definitions are not
  new resources in this diff and were not deployed.

The dependency manifests/lockfiles, Android build configuration, AWS template,
gateway/layer source and resource settings have no tracked differences from the
specified baseline. The tab-shell lifetime fix is the only additional frontend
file changed by this review beyond the earlier optimization set.

| Cost dimension | Review result |
|---|---|
| Bedrock, Polly, Textract, Transcribe | No new call sites, retries, model/voice changes or capture work |
| API Gateway / Lambda | Existing endpoints and timer cadence; equivalent actions have the same or fewer invocations than the starting implementation |
| DynamoDB | Same partitions, cutoff conditions, pagination, consistency and write paths; projections reduce transfer, not RCUs per evaluated query |
| Mutation refresh | Fresh reads remain necessary after writes; post-write reads no longer share a pre-write future. No extra automatic read is launched when an obsolete future finishes |
| Logs / metrics | No production logging/metrics additions; backend logging unchanged |
| Background work | No worker, queue, schedule or polling loop added; shell teardown now reliably stops its existing timer |
| Infrastructure / quotas / capacity | No change |
| Dependencies | No package or version added |

The five-row refresh cannot detect arbitrary edits/deletions outside that partial
page. Older rows refresh on the existing explicit history load/navigation. The
fix does not pretend that absence from a partial page proves deletion, or widen
the query to hide this limitation. Cost conclusions are based on code paths,
mock counts and unchanged configuration, not a measured AWS bill.

Projection billing and pagination were checked against the official
[DynamoDB Query API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html).
The selected attribute names do not collide with the official
[reserved-word list](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html).
The existing eventually consistent index behavior is preserved; starting a new
read after a write is not a new guarantee of globally immediate index visibility.

## Verification

| Check | Result |
|---|---|
| Flutter unit/widget suite | 301 passed, zero failures |
| Flutter static analysis | No issues found |
| Backend Jest with coverage | 740 passed in 91 suites |
| Backend coverage | 61.53% statements, 55.75% branches, 63.58% functions, 64.78% lines; existing floors passed |
| Gateway unit tests | 32 passed |
| Existing local WebSocket smoke | 24 clients, 12 slots; 12 admitted/completed, 12 rejected, zero interrupted, zero leaked leases |
| Offline evaluation | Exit 0; 100 synthetic cases, 98 prepared; no model requests |
| Canonical SAM lint | Valid, exit 0; CLI emitted an unrelated sandbox metadata-write warning |
| Modified JavaScript syntax and scoped diff whitespace | Passed |
| Android release APK | Built successfully, existing configuration and release signing setup |
| APK verification | Valid v2 signature, one signer; expected package/version/minimum SDK |
| App-owned Android JVM tests | 6 passed in 2 suites; scoped Gradle task successful |

The evaluation reports `numericGatePassed=false` and `NOT_HUMAN_CALIBRATED`
because independent human/model review inputs are absent. Exit 0 validates the
offline tooling/corpus; it is not a quality/calibration acceptance pass.
Docker's Linux engine is unavailable (`dockerDesktopLinuxEngine` pipe missing),
so packaged Linux ARM64/container tests were not run here.

The broad offline Gradle `testReleaseUnitTest` selector also selected third-party
plugin test tasks. Qlue's six native tests passed, but
`flutter_plugin_android_lifecycle:checkReleaseUnitTestAarMetadata` could not
resolve its uncached Mockito 5.23.0 **test** dependency offline. No dependency was
added or changed to bypass this. A scoped `:app:testReleaseUnitTest` run succeeded
using the existing results. Flutter compilation/asset-copy prerequisites were
excluded on that JVM run because the intended Flutter release had already built;
the earlier broad prerequisite unnecessarily re-entered Flutter assembly.
Third-party plugin unit tests remain unverified, not counted as Qlue passes.

### Android artifact verification

Build command, from `frontend/`:

```powershell
flutter build apk --release --no-pub --dart-define-from-file=env.json --dart-define=SPEECH_REVIEW=false
```

- Artifact: `frontend/build/app/outputs/flutter-apk/app-release.apk`.
- Size: **79,941,669 bytes** (Flutter displays 76.2 MB).
- SHA-256: `f813e14fa196464030a010961a3a0ed30e2d92ba9e20dcd8e0f47d602514c552`.
- Package: `com.qlue.sloths1`; version **1.0.10**, build **10010**.
- Minimum SDK **24**; target/compile SDK **36**.
- `apksigner verify --verbose` exits 0; v2 signature valid, one signer. This
  checks artifact signature validity, not an upgrade on an installed phone.
- `tmp/release-review-manifest.json` binds the artifact to the dirty source-tree
  fingerprint and configuration fingerprint without printing private values.
  `cleanReleaseInputs=false`. The clean publication gate was tested and correctly
  refuses the current modified/untracked release inputs.
- APK hash is unchanged after native test verification. No APK was installed,
  distributed or published.

Evidence is retained under `tmp/release-review-*`: failing-before probes,
passing focused/full suites, coverage JSON, analyzer, build/native results,
SAM lint, synthetic load and offline evaluation. All API, recognition and store
boundaries used by these tests are local mocks/fixtures. No live latency claim
is inferred from local synthetic admission timing.

## Outstanding release gates and unverified behavior

1. **Source completeness:** `frontend/lib/components/data_loading.dart` and new
   frontend/backend tests are still untracked, alongside modified release inputs.
   Include them in the reviewed commit. The existing clean-release manifest gate
   deliberately rejects this working tree. Do not publish only the tracked diff.
2. **Versioning:** existing source remains `1.0.10+10010`, already documented in
   `releases/1.0.10.md`. The local verification artifact is not a new release.
   Assign a new version/build number before distributing changed bytes; no
   signing setup or version was changed merely to pass verification.
3. **Device acceptance:** physical Android installation, microphone/audio routes,
   interruptions/backgrounding, low-memory behavior, accessibility and upgrades
   have not been exercised in this review. Follow `docs/DEVICE_ACCEPTANCE.md`
   against the exact final APK and intended backend configuration.
4. **Production measurements:** startup, frame build/raster timing, heap/RAM,
   slow-radio behavior and answer-finalization-to-text/first-audible-output
   p50/p95 remain unverified. No production profiling or paid load run occurred.
5. **Deployment acceptance:** local projection tests and unchanged schemas do not
   replace post-rollout acceptance. No live stack/configuration parity, IAM,
   CloudWatch behavior, or real-provider quality check is claimed by this review.
