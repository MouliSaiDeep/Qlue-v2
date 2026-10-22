# Android acceptance record

Run against the exact signed candidate APK and backend revision/configuration.
Record APK/source/config hashes, phone model, Android version, audio route,
network and result for every scenario. Use synthetic identities and resumes.
This file is a procedure; no physical-device passes are claimed by its presence.

| Scenario | Expected outcome | Result/evidence |
|---|---|---|
| New account, verification and sign-in | Clear progress, correct account ownership | Pending |
| Resume PDF upload / duplicate / oversized input | Owned result or clear bounded rejection | Pending |
| INTRO, RESUME, HR, JD and WEBSITE | Questions, answers and feedback stay associated | Pending |
| End immediately after the first question, without answering | No feedback report or history entry; existing empty entries stay hidden after refresh | Pending |
| Wi-Fi to mobile data, brief outage | Bounded recovery; accepted answer is not duplicated | Pending |
| Airplane mode and reconnect exhaustion | Honest error; draft retained in the current session | Pending |
| Incoming call, background/foreground, screen lock | Capture stops safely; no silent answer submission | Pending |
| Leave route, end interview, sign out, switch account | Old callbacks cannot reopen recording or leak content | Pending |
| Denied microphone / revoked permission | Actionable permission message; no futile retry loop | Pending |
| Busy capacity / daily voice limit / paused service | Appropriate busy or terminal message; microphone stays off | Pending |
| Cold gateway start and cancellation during startup | Readiness progress; no late microphone activation | Pending |
| Speaker, wired and Bluetooth headsets | No feedback loop; expected capture/playback route | Pending |
| Quiet speech, noisy room and long thinking pause | No fabricated transcript; bounded honest recovery | Pending |
| Duplicate tap / delayed final / lost completion | At most one accepted answer and preserved final evidence | Pending |
| Feedback unavailable / delayed / retry | No invented fallback score or indefinite spinner | Pending |
| Profile/history/report at 1.5x and 2x text | Usable controls, readable content, no overflow | Pending |
| TalkBack, keyboard focus and reduced motion | Meaningful labels/order and controlled motion | Pending |
| Empty history, first report and long transcript | Clear empty state and responsive scrolling | Pending |
| Delete account during active processing | Access ends and owned cleanup completes without revival | Pending |
| Upgrade from installed release | Same package/key; increasing version; data remains usable | Pending |

Test at least one lower-memory phone and one different Android/vendor version.
Track end-to-end task completion and p50/p95 answer-to-question delays, not only
frame rate. Time waiting for network/provider separately from UI rendering.

For a small usability session, observe several new users attempting resume upload,
one interview, understanding feedback and finding history without coaching them.
Record confusion, abandoned steps and whether the next practice action is clear.
Obtain consent before recording or retaining personal content.
