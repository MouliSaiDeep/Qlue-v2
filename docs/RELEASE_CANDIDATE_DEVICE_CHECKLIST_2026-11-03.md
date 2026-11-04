# Qlue Android candidate — physical-device acceptance

Derived from [DEVICE_ACCEPTANCE.md](DEVICE_ACCEPTANCE.md). **All rows are pending.**
No physical device was tested or APK distributed during candidate preparation.

Use the exact final APK/source/config fingerprints in the candidate manifest.
Record device model, Android version, network, audio route, date, tester, outcome
and evidence for each row. Cover one lower-memory phone and a second vendor or
Android version. Use synthetic identities, resumes and answers.

The current verification APK is `1.0.10+10010`. Upgrade acceptance is blocked
until a new version is approved, built and verified. Never substitute a different
signing key. This checklist does **not** authorize real paid AI/OCR/speech calls:
provider-dependent cases need a mock-backed device environment or a separate,
explicitly authorized bounded acceptance run. No such run occurred here.

| Done | Scenario | Required outcome |
|---|---|---|
| [ ] | Install; upgrade from installed release | Expected package and signer; approved increasing version; existing account data usable |
| [ ] | Register/verify, password recovery, sign-in, sign-out and switch A→B→A | Clear progress and errors; no old account data, upload continuation or reopened microphone |
| [ ] | Empty and long dashboard/history; rapid tabs/back/login; Date/Score/Module sort | Correct skeleton/error/empty states; older rows retained; recent scores update; no teardown exception or off-route refresh |
| [ ] | Resume valid/duplicate/oversized input; delete/set-active while reads are slow | Correct owned result/rejection; latest state wins; loading remains honest; one pending identical read |
| [ ] | INTRO, RESUME, HR, JD and WEBSITE; delayed or duplicated completion | Questions/answers remain associated; one accepted answer; no lost or fabricated text |
| [ ] | Natural speech, pauses under/at four seconds, quiet/noisy input | Short pauses retain the answer; endpoint submits once; uncertain audio is not invented or silently graded |
| [ ] | Wi-Fi→mobile, brief outage, airplane mode, reconnect exhaustion | Bounded recovery; retained draft; original answer identity/acknowledgement; honest terminal error |
| [ ] | Incoming call, background/foreground, screen lock, leave route/end | Capture stops safely; no silent submission or late restart; no lingering animation/refresh owner |
| [ ] | Denied/revoked microphone, busy/daily limit/paused service, cold-start cancellation | Actionable status; microphone stays off until ready; no futile or endless retries |
| [ ] | Speaker, wired and Bluetooth routes | Correct playback/capture transition, intelligible audio, no feedback loop |
| [ ] | End without answering; delayed/unavailable feedback; explicit Retry | Empty interview stays out of history; no invented score; accepted work remains recoverable |
| [ ] | 1.5×/2× text, small screen, TalkBack/focus, live reduced-motion toggle | Readable usable controls, stable transcript scroll, meaningful labels and stopped/restarted sphere motion |
| [ ] | Synthetic account deletion during accepted processing | Access ends, old callbacks stop, owned cleanup completes without revival |
| [ ] | Startup, long scrolling, memory and question text/audio timing | Record real measurements and environment; separate local/provider waits; no unsupported latency claim |

Evidence record: APK SHA-256 ___; source fingerprint ___; config fingerprint ___;
device/Android ___; network/audio route ___; result ___; remaining defects ___.
Do not retain credentials, personal resumes or private transcripts in Git.
