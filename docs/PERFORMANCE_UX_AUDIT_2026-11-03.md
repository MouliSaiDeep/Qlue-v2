# Performance and UX audit — 3 November 2026

Follow-up: the [release review](PERFORMANCE_RELEASE_REVIEW_2026-11-03.md) reproduces
and fixes additional lifecycle/state races and records the newer full test run,
Android build verification, and outstanding publication/device gates. Results
below describe the original optimization pass.

Local implementation against starting revision `8d326fc9cc9ac163c3f43be42d96a880c8d63518`.
No deployment, infrastructure provisioning, cloud benchmarking, or real provider
calls were performed. Existing changes in the deployment workflow, release
manifest, and other documentation were left intact.

## Scope and mechanisms preserved

Inspected the Flutter entry point/router, account-owned Provider tree, data
providers and services, dashboard/history/resume/report screens, interview
orchestrator, WebSocket transport, system and AWS recognition, playback,
interview API/worker pipeline, dashboard aggregates, DynamoDB helpers/models,
provider clients, resume processing, event-driven recovery, gateway code/tests,
assets, CI, and existing performance/operations/device documentation.

The application already has substantial optimization and recovery machinery:

- Account-keyed providers and login-generation-owned HTTP cancellation/token
  refresh; interview generations reject obsolete microphone/socket callbacks.
- Parallel dashboard reads, refresh throttling, and existing visible-tab
  auto-refresh. No new refresh timers or shorter refresh intervals were added.
- Server-side history cursors bound to the authenticated user; the frontend
  follows empty filtered pages and rejects a repeated cursor. The UI's existing
  100-record retrieval cap and local sorting were preserved.
- Transcript-only recognition rebuilds, a fixed transcript viewport, bounded
  automatic recovery, original answer IDs, acknowledgements, accepted-answer
  persistence, lease fencing, and replay of stored question audio.
- Microphone/ticket preparation under question playback, URL-first question
  audio, context-window queries with a pinned opener, and canonical turn commits.
- Warm SDK clients, cached SSM configuration, bounded provider attempts,
  stop/quota gates, PDF/OCR validation and stable processing attempt identities.
- Targeted stream/queue recovery and feedback outboxes. No new workers or
  recurring server scans were introduced.

## A. Optimization inventory

Statuses describe the starting implementation. A partial status means a real
gap existed alongside mechanisms that were already working.

| Area | Starting status | Evidence / problem | Decision and changed files |
|---|---|---|---|
| 3.1 Provider rebuild scope | PARTIALLY IMPLEMENTED | Interview transcript already has a `Selector`; dashboard/history subscribe to unrelated provider/auth changes | Narrow data/auth subscriptions in `frontend/lib/screens/tabs/{dashboard,history}_screen.dart`; preserve transcript selector |
| 3.1 Interview animation | PARTIALLY IMPLEMENTED | Repaint boundary exists, but the sphere calls `setState` every tick and repeats four shared trig calculations per particle | Paint notifications, one shared rotation calculation and reused `Paint` in `frontend/lib/screens/interview/particle_sphere.dart` |
| 3.1 Controllers / motion | PARTIALLY IMPLEMENTED | Controllers generally disposed; sphere only reads `animate` during initialization | Stop/restart ticker when motion preference changes; dispose paint notifier; interview screen observes preference/system reduced motion |
| 3.2 Dashboard loading | MISSING | Blank spinner; first failed fetch leaves `hasLoadedOnce=false`, hiding recovery indefinitely | Static geometry placeholders, explicit first-load Retry, retain previously loaded cards during refresh |
| 3.2 History loading | PARTIALLY IMPLEMENTED | Gates on dashboard's loaded flag, so direct history entry can wait indefinitely even after history succeeds | Independent history loaded/error state; static skeleton and Retry |
| 3.2 Resume loading | PARTIALLY IMPLEMENTED | Lazy list exists; initial wait uses only spinner and an initial read error can appear as empty | Static resume placeholders and explicit Retry in `frontend/lib/screens/resume/resume_upload_screen.dart` |
| 3.2 Feedback / analysis loading | ALREADY IMPLEMENTED | Feedback screen has generation status, bounded reads and terminal auth/missing/unavailable states; analysis has a deadline | Preserve these flows; no new polling, invented scores, or progress percentages |
| 3.3 History/resume lists | PARTIALLY IMPLEMENTED | Lazy sliver/list builders already exist; history re-sorts on every rebuild; keys absent in reduced-motion cards and resume rows | Memoize history sort by source identity/filter; add stable row keys |
| 3.3 Transcript / recent activity | ALREADY IMPLEMENTED | Fixed transcript scroll owner and lazy recent-activity builder | Preserve layout, automatic following and manual transcript review |
| 3.4 Bundled images | PARTIALLY IMPLEMENTED | 2160×4096 module art is displayed at about 140 logical pixels wide, without a decode target | Add device-pixel-ratio-aware `cacheWidth` in `ai_modules_screen.dart` and `components/qlue_logo.dart`; original files unchanged |
| 3.4 Fonts | ALREADY IMPLEMENTED | Montserrat is bundled; runtime Google Fonts fetching is disabled; package is actively used by theme | Preserve fonts/package; no unverified deletion or visual identity changes |
| 3.4 Old speech model assets | NOT APPLICABLE | Large ONNX files exist in source but `assets/speech/` is absent from the app asset manifest | Do not claim APK savings from removing unbundled files |
| 3.5 Dashboard deduplication | PARTIALLY IMPLEMENTED | Boolean prevents overlap but duplicate callers return before the pending operation finishes | Return the same pending future from `context/dashboard_provider.dart` |
| 3.5 History deduplication/state | MISSING | Concurrent identical reads can duplicate requests; 45-second dashboard refresh can overwrite full history with five rows | Coalesce identical reads, protect latest filter selection, separate recent activity from loaded history |
| 3.5 Resume reads | MISSING | List callers can overlap; two-second polling can overlap a slow detail GET | Coalesce only identical in-flight reads in `context/resume_provider.dart`; distinct resume IDs remain independent |
| 3.5 Resume mutation invalidation | PARTIALLY IMPLEMENTED | Mutations already refresh; naive read deduplication could join a pre-mutation snapshot | After a successful write, await any earlier list read and then fetch fresh state; do not deduplicate mutations |
| 3.5 Authentication | PARTIALLY IMPLEMENTED | Credential refresh already shares in-flight work and cancels on login changes; app-level sync/profile reads have separate triggers | Preserve ownership/refresh controls; defer wider auth caching until profile/sync invalidation is explicitly covered |
| 3.5 Interview initialization/answers | ALREADY IMPLEMENTED | Socket/request IDs, receipts, durable state/leases and original pending answer identity prevent repeated paid work | Preserve all mutation, acknowledgement and reconnect contracts; no answer deduplication changes |
| 3.5 Resume processing / feedback jobs | ALREADY IMPLEMENTED | Attempt claims, versioned input, feedback outboxes and durable recovery fence duplicates | Preserve workers and at-least-once completion semantics |
| 3.6 Independent requests | ALREADY IMPLEMENTED | Dashboard uses `Future.wait`; summary performs independent user/session reads concurrently | No request-count benefit from changing these again; leave dependent interview admission/persistence ordered |
| 3.7 Timeouts/retries | ALREADY IMPLEMENTED | Dio connect/receive deadlines, token deadline, playback deadlines, bounded analysis/recovery, paid-attempt gates | No retry-budget increase or shorter AI deadline; fix loading/error state instead |
| 3.8 Pagination | PARTIALLY IMPLEMENTED | Backend continuation/security and frontend cursor safety already work; UI materializes at most 100 records and sorts that set | Preserve contract/cap; fix overwrite/duplicate-request defects; defer viewport paging because global score/module sorting would otherwise change |
| 3.9 Answer-to-next-question pipeline | PARTIALLY IMPLEMENTED | Finalize → accepted answer → generation → synthesis/upload → atomic turn commit → delivery/playback; late/stale events are fenced | Reduce UI work and remove redundant initialization status timer; no speculative generation or change to answer/turn commits |
| 3.10 Progressive text | PARTIALLY IMPLEMENTED | Bedrock stream exists, but worker intentionally buffers output and sends canonical text after validation/commit; `earlyTts` is initialized to null and is not enabled | Do not expose incomplete structured/model output or re-enable segmented Polly calls; requires a separate correctness/latency design |
| 3.11 Microphone/playback | ALREADY IMPLEMENTED | Preparation is reused under playback; stopped capture precedes playback; stored audio refresh/replay avoids synthesis | Preserve quality, flush boundaries, deadlines and recovery; observe `isPreparingVoice` so existing readiness guidance updates |
| 3.12 DynamoDB | PARTIALLY IMPLEMENTED | Summary already projects; module stats and trends retrieve full session context they do not use | Add exact aggregate field projections in `backend/src/handlers/dashboard/getModuleStats.js` and `getScoreTrends.js` |
| 3.13 Lambda computation | ALREADY IMPLEMENTED | SDK clients initialized at module scope; SDK/provider/deadline safeguards already exist | Reuse existing clients/settings; smaller query results reduce deserialization; no memory/concurrency changes |
| 3.14 Background work | ALREADY IMPLEMENTED | Targeted recovery, leases, delayed watchdogs and completion guards | Leave infrastructure/workers unchanged; cancel obsolete existing resume timers and prevent overlapping polling reads |
| Caching | PARTIALLY IMPLEMENTED | Account-owned dashboard state and warm config cache already exist | Add in-flight sharing only, with fresh reads after completion/mutation; no persistent sensitive cache, external cache or TTL-stale feedback |
| Diagnostics | PARTIALLY IMPLEMENTED | Existing local playback diagnostics, provider metrics, telemetry redaction and device acceptance procedure | Use local mock counters, decoder dimensions and widget identity; no production log/metric additions |

## B. Implementation and regression risks

| File(s), relative to repository root | Change and expected UX benefit | Main regression risk / protection |
|---|---|---|
| `frontend/lib/context/dashboard_provider.dart` | Shared pending futures; independent recent/full history and loading/error states; obsolete filter responses ignored | Reordering completions; tests cover shared callers, filter rejoining, history retention, initial failure/empty recovery |
| `frontend/lib/context/resume_provider.dart` | Shared list/detail reads; late disposed results ignored; terminal/removed polling timers canceled; one terminal completion refresh | Stale post-mutation reads; explicit fresh refresh after old read, with regression test; distinct IDs/retries preserved |
| `frontend/lib/components/data_loading.dart` | Static accessible card placeholders and explicit Retry | Narrow screens, themes and fake completed data; tests cover both themes, narrow width, semantics and absence of values/animation |
| `frontend/lib/screens/tabs/dashboard_screen.dart` | Narrow subscriptions, placeholders/retry, existing cards remain visible while refreshing, mounted callback guard | Empty-state flash or stale recent rows; separate recent list and first-load gate |
| `frontend/lib/screens/tabs/history_screen.dart` | Independent initial loading, narrow subscriptions, cached sort, stable keys and retry | Filter/scroll behavior; existing sort choices, builders, animation delays and history cap preserved |
| `frontend/lib/screens/resume/resume_upload_screen.dart` | Initial skeleton/error recovery and stable resume keys | Upload/empty/error branch precedence; upload flow and existing list remain intact |
| `frontend/lib/screens/interview/particle_sphere.dart` | Repaint without widget/layout rebuilding per tick; shared trig and `Paint`; live reduced-motion updates | Painting could stop or gestures/state could drift; motion notifier owns repaint, controller/notifier disposed, state/color/gesture math preserved |
| `frontend/lib/screens/interview/interview_session_screen.dart` | Remove three-second timer cycling a single unchanged message; observe motion and microphone readiness | Missing voice-status rebuild; selected readiness flag and updated smoke fixture; no speech/persistence code changed |
| `frontend/lib/components/qlue_logo.dart`, `frontend/lib/screens/tabs/ai_modules_screen.dart` | Decode art/logo for physical display width | Softness on high-density screens; target follows DPR, original encoded assets unchanged |
| `backend/src/handlers/dashboard/getModuleStats.js`, `getScoreTrends.js` | Fetch only consumed attributes, reducing transfer/deserialization | Omitted scoring/filter/date field; projection-aware mocks return only selected fields and check page cursors, ownership, valid zero scores and skipped empty/discarded rows |
| `frontend/test/performance_regression_test.dart`, `data_loading_test.dart`, `data_screens_loading_test.dart`, `interview_flow_test.dart` | Provider concurrency/disposal/mutation, motion/rebuild, loading and smoke coverage | No real services used; existing mock updated for newly observed readiness property |
| `backend/tests/unit/dashboardProjection.test.js` | Four additional projection/pagination/authorization checks | Tests check actual projected shape, not merely full fixture responses |

No changes were made to interview evaluation logic, answer IDs, persistence,
authentication, provider model/voice settings, security gates, or API response
schemas. No new runtime dependencies were introduced.

## C. Cost protection

Expected cost impact follows the code paths and local request-count tests; this
is not a measured AWS bill forecast.

| Dimension | Outcome | Evidence / limit |
|---|---|---|
| Additional AWS services | None | No infrastructure/dependency/resource changes in this work |
| Bedrock requests | Unchanged | Generation and provider boundaries untouched |
| Polly characters/calls | Unchanged | Audio synthesis, voice policy and replay unchanged; no early/speculative TTS enabled |
| Transcribe usage | Unchanged | Capture, quality, stream limits and prewarming unchanged |
| Textract requests | Unchanged | OCR and durable processing unchanged |
| API Gateway / Lambda invocations | Same or fewer for equivalent actions | Same endpoints; pending read coalescing removes duplicates; no retry/timer/admission increases |
| DynamoDB reads | Same or fewer overall | Duplicate frontend reads removed; aggregate query partitions, cutoffs and cursors unchanged |
| DynamoDB read units for each aggregate query | Unchanged | Projection reduces returned attributes, not evaluated item size/read units; two-page projection tests retain two queries |
| DynamoDB writes | Unchanged | No write path modified |
| CloudWatch production log volume | No increase | No backend log/metric additions; one Flutter build debug print removed |
| Fargate/host resources | Unchanged | Gateway, counts, limits and hosting configuration untouched |
| Background activity | No new activity | Existing resume timer cadence retained; overlapping/obsolete reads suppressed; redundant local status timer removed |
| Lambda memory/concurrency/frequency settings, quotas | Unchanged | No SAM, environment, IAM, queue, index, scheduling or billing setting edits |
| Network transfer | Same or lower for equivalent successful actions | Fewer duplicate GETs and smaller aggregate query responses; encoded asset bundle unchanged |

AWS explicitly states that projection does not lower Query read capacity charges:
[DynamoDB Query API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html).
No RCU savings are claimed for the projection alone. A user's voluntary Retry
still makes the original read, as expected; no automatic retry budget was added.
Larger monthly savings and live p50/p95 changes remain unmeasured.

## D. Measurements

The controlled comparison replays the starting revision and updated source with
the same mocks and synthetic data. Baseline provider copies receive only an API
injection constructor/import-path adaptation; request/refresh/timer behavior is
otherwise the original implementation. The particle baseline is unchanged source.
Evidence and runnable comparison fixture are in `tmp/performance-2026-11-03/`.

| Controlled local scenario | Before | After | Interpretation |
|---|---:|---:|---|
| Two simultaneous resume-list readers, one pending response | 2 API-service calls | 1 | Identical reads share the pending result |
| Slow resume detail across two existing polling ticks (simulated seconds 2 and 4) | 2 API-service calls | 1 | A slow response no longer causes overlapping reads |
| History rows retained after loading 50 and then refreshing dashboard | 5 | 50 | Full timeline is preserved; dashboard still has five recent rows |
| Sphere gesture widget replacements across ten simulated 16 ms animation ticks | 10 | 0 | Painting continues through the motion notifier without rebuilding the gesture subtree |
| Decoded Resume card image at 140 logical pixels, DPR 3 | 2160×4096 | 420×796 | Actual local decoder output dimensions; original encoded PNG unchanged |
| Estimated RGBA storage for that decoded image, dimensions × 4 bytes | 35,389,440 bytes | 1,337,280 bytes | Derived buffer estimate, not measured app/process memory |

All six comparison/preview checks passed. Machine-readable measurements are in
`tmp/performance-2026-11-03/comparison.json`; replay source and output are
`comparison_test.dart` and `comparison-tests.txt` in the same directory. Static
dashboard/history loading PNGs were rendered and inspected there. Flutter's test
font renders the temporary preview heading as boxes; the placeholders themselves
contain no text and use the application's theme colors.

No end-to-end production timing, low-end Android frame build/raster timing,
process/heap memory, radio behavior, real microphone accuracy, startup timing,
dashboard/history/report render latency, interview initialization timing,
answer-finalization-to-text timing, or first-audible-output timing is claimed.
There was no configured device session or approved paid benchmark environment.
The decoder's output dimensions and estimated RGBA bytes are not process RAM.

## E. Validation

- Backend baseline: **736 tests in 90 suites passed** before backend edits.
- Backend final with coverage: **740 tests in 91 suites passed**; statements
  61.53%, branches 55.75%, functions 63.58%, lines 64.78%; configured floors pass.
- Final full Flutter suite: **288 passed**, zero failures.
- Final `flutter analyze --no-pub`: **No issues found**.
- Formatting was applied to the updated providers, sphere/interview/dashboard
  code, new components and tests. Scoped `git diff --check` passes. Existing
  surrounding formatting in large history/resume/module screens was retained.
- Focused Flutter concurrency/rendering regressions: **10 passed**.
- Focused loading/component and actual dashboard/history/resume screen checks:
  **9 passed**. These cover loading, initial error, Retry, successful empty state,
  direct history entry, narrow layout, both themes and static semantics.
- Gateway: **32 passed**, synthetic audio and stubbed provider/store boundaries.
- Local evaluation tool: exit 0; 100 synthetic cases, 98 prepared. It reports
  `NOT_HUMAN_CALIBRATED` and `numericGatePassed=false` without human/model review
  inputs. This is tooling validation, not a model-quality acceptance pass.
- Initial full Flutter run found two smoke-test failures from a mock lacking
  the newly observed `isPreparingVoice` getter. The fixture now supplies the
  actual initial value; the final full rerun passes.
- A subsequent new loading test lacked the application's required theme wrapper;
  that fixture was corrected. The focused screen/component rerun passes all nine
  tests; no production exception was involved in either fixture correction.
- Flutter SDK and local-loopback test access required execution outside the
  workspace-only restriction. The ordinary Flutter launcher initially stalled
  on the SDK lockfile; direct SDK execution with the required access worked.
- No cloud acceptance, AWS deployment, real-provider call, paid load test,
  signed APK/device run, SAM/container build, or release publication was run.
- Existing backend security/answer/recovery/pagination suites were included in
  the full backend and Flutter runs. These do not establish real-device audio
  quality or deployment acceptance.

Final logs: `tmp/perf-final-flutter.txt`, `tmp/perf-final-analysis.txt`,
`tmp/perf-final-backend.txt` / `.json`, `tmp/perf-gateway.txt`,
`tmp/perf-loading-tests.txt`, and `tmp/perf-evaluation.txt`. The abandoned initial
Flutter/Dio baseline probe was replaced with injected service mocks because its
interceptor timing did not give a valid count; no figures from that probe are
used. The successful original-versus-updated comparison above supplies the
frontend baseline. No test failure remains in the final runs; human/model
calibration and physical-device acceptance remain separate, unexecuted gates.

## F. Remaining recommendations / deliberately skipped changes

1. Profile an exact APK on a lower-memory Android phone and one second vendor,
   using the existing `docs/DEVICE_ACCEPTANCE.md` procedure. Measure startup,
   slow-network screen waits, frame build/raster times, heap/decoded images,
   answer-to-text and first audio p50/p95. Keep provider usage explicitly bounded.
2. Evaluate earlier **validated, durably owned** text delivery separately.
   Moving text ahead of synthesis/atomic commit can show a question that never
   becomes canonical after a lease loss or termination. Current tokens may be
   structured/incomplete. Do not enable the dormant acknowledgment-synthesis
   path: segmented synthesis could increase paid calls or voice artifacts.
3. For users with more than 100 sessions, design viewport pagination together
   with server/global sorting and complete totals. Simply paging the current
   date endpoint would change the meaning of Score/Module sorting and badges.
   No new index or scan was added to solve this speculatively.
4. Dashboard aggregate computation still traverses historical sessions. Removing
   that work requires validated rollups/write changes or a combined endpoint;
   do not cache stale feedback or add writes/index costs without a separate cost
   and consistency analysis. Current bounded query helper behavior is unchanged.
5. Consider offline lossless asset recompression with pixel/bundle verification
   if APK download size matters. This change targets decoded memory only; no
   image format conversion, visual replacement, font removal or unsupported
   deletion was performed. Existing Google Fonts/theme use remains active.
6. Consolidate app-level auth/profile synchronization only with explicit tests
   for account changes, verified-email/profile mutations and sign-out. Existing
   Dio refresh-sharing and login ownership should remain authoritative.
7. The unused `FeedbackProvider` has its own retry implementation, while the
   routed report screen fetches directly. Unifying them would change behavior;
   it was left alone. Preserve terminal unavailable/auth states and report
   invalidation rather than adding a sensitive-content cache.
8. Preserve existing worker/queue watchdogs and quota/voice locks. Redis,
   provisioned concurrency, added Fargate tasks, more expensive models, new
   polling infrastructure and speculative AI work are outside this cost-neutral
   implementation and were not introduced.
