# Qlue improvements — 22 October 2026

Implemented locally for public-launch preparation. Existing working-tree changes
were preserved. No AWS deployment, paid AI evaluation, Git commit/push, tag or
public release was performed.

## Delivered changes

| Area | Implemented |
|---|---|
| Interview reliability | Separate capacity/daily-limit responses; terminal daily-limit handling without automatic retry loops; visible voice preparation state; retained draft ownership |
| Concurrency | Configurable per-task transport limit, randomized shared-slot starting points, multi-replica admission/lease and drain tests |
| Public infrastructure | Optional two-to-six-task Fargate scale-out, minimum two tasks, CPU/memory policies with automatic scale-in disabled; provisioning remains off by default |
| AI quality tooling | 100 synthetic cases across five modules; 98 prepared requests; two blind reviewer forms; schema/evidence validation, stale-result checks and per-model repeatability/human comparison |
| Maintainability | Extracted profile settings/preferences, interview state/response recovery and feedback presentation helpers |
| Accessibility | Wrapping profile labels/trailing values at large text sizes; bounded, scrollable appearance sheet |
| Security | Additional URL admission guards and SSRF/DNS regression checks; compatible production/development dependency patches |
| Operations | Allowlisted EMF model/token/feedback/audio measurements; privacy and logging-failure isolation tests |
| CI/releases | Flutter PR/main checks, backend coverage floors, evaluation checks, synthetic load checks, high/critical development audits, matching release tag/version gate and source/config/APK manifests |
| Documentation | Replaced outdated root/frontend introductions and added release, operations, concurrency, device and scoring evaluation guides |

Refactoring remains incremental. The provider still owns session state, and
larger screens still offer opportunities for further decomposition. No complete
architecture rewrite or usability certification is claimed.

## Verification

- Backend: **615 tests / 80 suites passed** after installing the patched dependencies.
- All-source backend coverage: **59.13% statements, 52.96% branches, 59.93% functions, 62.70% lines**.
- Flutter: **266 tests passed**; final static analysis reported **no issues**.
- Audio gateway: 30 tests passed in the full run; the subsequently added replica-drain case passed in its focused run (**31 distinct cases passed**).
- Synthetic load: 24 clients, two local server instances, 12 shared slots;
  12 admitted, 12 rejected, all 12 admitted streams completed, zero leaked leases.
  No AWS/provider calls were made by the load harness.
- Graceful replica drain: affected streams were explicitly interrupted while
  the surviving replica completed; all admitted capacity was released.
- Optional audio infrastructure: SAM lint passed. Workflow YAML, runtime/tool
  syntax, source reachability and changed-file whitespace checks passed.
- Docker Desktop's Linux daemon was unavailable, so a fresh packaged Linux ARM64
  container smoke could not be run locally. The CI checks remain configured.

Logs and local evidence are under `tmp/public-launch-20261022/`. Local Windows
latency observations are not AWS performance benchmarks. GitHub workflows have
been inspected and parsed locally, not executed on GitHub in this task.

## Dependency audit result

`follow-redirects` was updated from 1.16.0 to 1.16.1 in both the backend and
application-layer lockfiles, addressing the
[array-header](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8) and
[sensitive-header](https://github.com/advisories/GHSA-8r9p-f939-6h3c) advisories.
The development server's `proxy-addr` was updated from 2.0.7 to 2.0.8 for its
[mapped-address trust advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).
Only these compatible transitive package versions changed; no direct dependency
or test-framework major version was changed. Install scripts were disabled.

Fresh production audits reported **zero vulnerabilities** for the backend,
audio gateway, application dependency layer and delivery layer. The root/layer
lockfiles had zero version drift among 300 common package entries.

The full development audit still reports 19 moderate package entries propagating
one upstream [`sprintf-js` advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
through the Jest/coverage configuration chain. The advisory lists no patched
version. These packages are excluded from the production audits/layer. No high
or critical development findings remain after the compatible patches. A forced
downgrade of Jest was not used as a workaround. Track this residual build-tool
issue; production audit cleanliness is not a claim that every dependency is clear.

## Signed review APK

- File: `output/Qlue-1.0.10-quality-review.apk`
- Package: `com.qlue.sloths1`; version **1.0.10 / 10010**; minimum Android API **24**.
- Bytes: **79,925,213**.
- SHA-256: `5cf68377c2ed3dc4aa9d81fe8906c2db10be308a3ea5c9d19fed5cbbbdfef73c`.
- Release certificate SHA-256: `cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd`, matching the existing release key.
- APK signature, three-ABI packaging, bundled-font checks, absence of experimental
  offline native/model assets and 16-KiB ZIP alignment passed.
- Existing AWS speech settings were retained. The APK does not itself migrate
  the backend or change server-side capacity.
- Fingerprints: `output/Qlue-1.0.10-quality-review.manifest.json`.

The review manifest intentionally reports uncommitted release inputs. This
working-tree APK is not presented as an immutable published release. Review and
commit the intended source before using the clean-release gate.

## Remaining launch gates

1. **Human scoring validation:** 98 forms per reviewer are generated in
   `tmp/public-launch-20261022/human-review/`. No human grades or model runs were
   invented. Complete independent reviews, budgeted repeated model runs and
   representative/held-out evaluation. Calibration remains explicitly unestablished.
2. **Physical phones and usability:** follow [device acceptance](DEVICE_ACCEPTANCE.md).
   The signed artifact is ready; no physical-phone result is claimed.
3. **Cloud deployment and capacity:** review costs, quotas, routing and a change
   set; perform bounded live load/failure/rollback acceptance before increasing
   traffic. The currently deployed single host and live limits remain unchanged.
4. **Operational acceptance:** deploy metrics and prove CloudWatch extraction,
   operator alert delivery and useful-outcome/cost measurements with owned probes.
5. **Source consolidation:** review new files and pre-existing edits in focused
   commits. Do not bulk-stage private investigation material. No existing user
   changes were committed on the user's behalf.

See [public launch](PUBLIC_LAUNCH.md), [release process](RELEASES.md),
[feedback evaluation](FEEDBACK_EVALUATION.md) and [operations](OPERATIONS.md).
