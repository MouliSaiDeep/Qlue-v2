# Qlue performance release-candidate preparation — 3 November 2026

Baseline: `8d326fc9cc9ac163c3f43be42d96a880c8d63518`. This is a **local verification
candidate**, not a published release. No commit, push, tag, deployment,
distribution, device installation, AWS configuration change, or real paid
Bedrock/Polly/Transcribe/Textract call was made.

## Version proposal — approval required

Recommend **`1.0.11+10011`**, corresponding to proposed tag `v1.0.11`. The existing
release encoding is `major*10000 + minor*100 + patch`. Local tags, fresh remote
`git ls-remote --tags origin`, and the public GitHub release listing were checked
on 3 November 2026: their latest version is `v1.0.10`, and `v1.0.11` is unused.
Public release metadata: [GitHub releases](https://github.com/MouliSaiDeep/Qlue-v2/releases).
This check cannot see private draft releases or Play Console internal tracks;
confirm those before reserving the version and recheck GitHub immediately before
tagging. No tag was reserved by this check.

**No version edit was made.** `frontend/pubspec.yaml` and the verification APK
remain `1.0.10+10010`. Explicit approval is required before changing the version;
then rebuild, reverify/fingerprint, and accept that exact new APK. Existing
configuration and signing credentials are preserved.

## Exact files to commit for this performance candidate

The candidate's allowlist/overlay includes every modified or untracked file under
`frontend/lib`, `frontend/test`, `backend/src`, and `backend/tests` relative to the
baseline: **19 source/test files**. The six new files must not be omitted merely
because an ordinary Git diff excludes untracked files. Include the four supporting
documents below as well: **23 files total** for the performance changes and their
release documentation. Do not bulk-stage the full historical worktree.

### Modified source and existing test files — 13

```text
backend/src/handlers/dashboard/getModuleStats.js
backend/src/handlers/dashboard/getScoreTrends.js
frontend/lib/components/qlue_logo.dart
frontend/lib/context/dashboard_provider.dart
frontend/lib/context/resume_provider.dart
frontend/lib/screens/interview/interview_session_screen.dart
frontend/lib/screens/interview/particle_sphere.dart
frontend/lib/screens/resume/resume_upload_screen.dart
frontend/lib/screens/tabs/ai_modules_screen.dart
frontend/lib/screens/tabs/dashboard_screen.dart
frontend/lib/screens/tabs/history_screen.dart
frontend/lib/screens/tabs/tabs_screen.dart
frontend/test/interview_flow_test.dart
```

### New source and test files — 6

```text
backend/tests/unit/dashboardProjection.test.js
frontend/lib/components/data_loading.dart
frontend/test/data_loading_test.dart
frontend/test/data_screens_loading_test.dart
frontend/test/performance_regression_test.dart
frontend/test/performance_release_review_test.dart
```

### Supporting documents — 4

```text
docs/PERFORMANCE_UX_AUDIT_2026-11-03.md
docs/PERFORMANCE_RELEASE_REVIEW_2026-11-03.md
docs/RELEASE_CANDIDATE_2026-11-03.md
docs/RELEASE_CANDIDATE_DEVICE_CHECKLIST_2026-11-03.md
```

After version approval, `frontend/pubspec.yaml` becomes one additional required
release change; it is intentionally absent from this changed-file allowlist now.
If a tag workflow needs release notes, prepare them only for the approved version.

## Historical work preserved separately

Five other tracked modifications predate this performance work and were retained:

```text
.github/workflows/deploy.yml
audit/release-manifest.cjs
docs/BACKEND_IMPROVEMENT_PLAN_2026-10-22.md
docs/FEEDBACK_EVALUATION.md
docs/OPERATIONS.md
```

They are not discarded, reverted or silently folded into the performance overlay.
Review/commit them separately if they belong in the eventual release revision.
The complete initial status has 1,779 modified/untracked paths, mostly historical
audit logs, screenshots, scripts and review packets. Their names are recorded in
`tmp/rc-git-status.txt`; the complete tracked diff is in
`tmp/rc-full-tracked-diff.patch`. Five historical modified-file hashes were saved
for preservation checks. Older untracked audit/review material was not selected
for automatic committing or distribution. In particular, keep private snapshots,
signing files, configuration, transcripts and investigation binaries out of Git.

## Nine regression fixes

All nine remain present in source and are exercised by the current suite:

| Fix | Source mechanism / regression coverage |
|---|---|
| R1: old resume work after account disposal | Mutation/stage guards and closed upload client; disposed-upload and mutation-entry mocks |
| R2: shell teardown exception / refresh lifetime | Cached provider reference in `TabsScreen.dispose`; repeated real GoRouter navigation test |
| R3: late detail undoes successful mutation | Resume read epoch; active-resume mutation test |
| R4: late detail overwrites new list | List-snapshot guard; reversed detail/list completion test |
| R5: old completion evicts new pending detail | Future-identity cleanup and post-write sharing invalidation test |
| R6: loading cleared during pending mutation | Overlapping-operation count; delayed read/write test |
| R7: full history misses recent updates | Merge already-requested recent rows, retain older rows/module/date/100-row bound; request-count test |
| R8: slow full read rolls back recent response | Recent-response version guard; reversed responses and authoritative next full-read test |
| R9: pending-filter rejoin leaves stale error | Notify on selection change; rapid HR/INTRO/HR error test |

No further feature or optimization was added during preparation. No production
source changes were needed. The [review](PERFORMANCE_RELEASE_REVIEW_2026-11-03.md)
contains the original reproductions, fixes and cost analysis.

## Verification and local artifacts

All current project checks passed:

| Check | Result |
|---|---|
| Flutter unit/widget tests | 301 passed |
| Flutter static analysis | No issues found |
| Backend tests with coverage | 740 passed in 91 suites; existing coverage floors passed |
| Gateway tests | 32 passed |
| Local synthetic WebSocket smoke | 24 clients / 12 slots; 12 completed, 12 rejected; zero interrupted/leaked leases; zero provider calls |
| App-owned Android JVM tests, explicitly rerun | 6 passed in 2 suites |
| Android release APK | Built successfully using unchanged configuration/signing setup |
| APK signature | Valid v2 signature, one non-debug signer |
| APK package / version | `com.qlue.sloths1`, `1.0.10`, code `10010` |
| APK SDK / architecture / fonts | Minimum 24, target/compile 36; ARM64, ARMv7, x86_64; two original bundled fonts; unused offline speech resources absent |
| Preservation | 309 client inputs unchanged, including private config/signing-property fingerprints; five historical tracked edits unchanged |
| Diff whitespace and dependency/resource configuration | No whitespace errors; package locks, Android source config, AWS template, gateway/layer source unchanged from baseline |

Verification APK: **79,941,669 bytes**. SHA-256:

```text
0384c054c1902d23c296aa03b60c80e1351fe76d8e7565d2c79547186bd0a708
```

Public signer certificate SHA-256:

```text
cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd
```

The native test command was scoped to `:app:testReleaseUnitTest --rerun` in
offline mode, reusing the verified release's Flutter outputs by excluding its
compile/asset-copy prerequisites. This reran Qlue's tests without selecting
third-party plugin tests or downloading new test dependencies. No device or
networked provider was used. Signature verification confirms artifact validity;
install/upgrade compatibility still needs device acceptance.

The offline evaluation tool exited 0 with 100 synthetic cases / 98 prepared;
`numericGatePassed=false` and `NOT_HUMAN_CALIBRATED` remain, as expected without
human/model review inputs. This is not a scoring-quality certification.

Evidence uses `tmp/rc-*`. The local candidate directory is
`output/release-candidate-2026-11-03-performance/`: source overlay, exact file/hash
inventory, patch, manifest, logs, checklist and a verification APK. The overlay
is applied conceptually to the named baseline; it is not a standalone checkout
or a distribution package and contains no private compile/signing inputs.

Its inventory asserts that every current source/test change in the four scoped
directories is included. ZIP entries and file bytes are checked against the
allowlist. The manifest fingerprints actual working release inputs and config
without printing config values. `cleanReleaseInputs=false` is expected until a
reviewed commit exists. Local files were prepared without touching the Git index.

## Cost boundary and remaining gates

No dependency, provider call, retry budget, production log/metric, paid service,
worker, recurring activity, resource configuration or quota was added. Existing
same-or-fewer request paths, projections and timer shutdown are retained.
Tests use fixtures/mocks; the WebSocket smoke is local and reports zero provider
calls. No cloud deployment or paid load test is part of preparation.

Before publication:

1. Approve and apply the version increment after checking private release/store
   reservations; rebuild and verify that new version. Approval is pending.
2. Review and commit the exact source/test/doc files above, deliberately decide
   which historical changes belong, and pass the existing clean-input manifest
   gate. Nothing has been staged or committed automatically.
3. Complete the [physical Android checklist](RELEASE_CANDIDATE_DEVICE_CHECKLIST_2026-11-03.md)
   on the exact final APK, including upgrade, audio routes, interruptions, account
   changes, slow networks, reduced motion and low-memory devices. All rows remain
   pending; provider-dependent scenarios require mocks or separate bounded paid
   acceptance authorization.
4. Packaged Linux ARM64/container tests need an available Docker Linux engine.
   Third-party plugin JVM tests previously lacked an offline Mockito test
   dependency; app-owned Android tests are reported separately.
5. Production startup/frame/memory/answer-to-text/first-audio timings, live backend
   parity/IAM, real-provider quality and independent human scoring calibration
   remain unverified. The offline corpus check is not a calibration pass. No
   unapproved production measurement is performed to close these gaps.
