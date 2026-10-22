# Hide interviews with no accepted answers

Ending an interview immediately after its first AI question must not create a
feedback-history entry. Generating a question alone is not a candidate answer.

The termination path already sets `discarded=true` and `feedbackExpected=false`
when the durable accepted-answer count is zero, and does not publish feedback.
The history endpoint had an exception that exposed these discarded sessions
again whenever feedback was not expected. That exception is removed.

History now excludes discarded sessions and sessions with an explicit zero
accepted-answer count. Genuine answered sessions remain visible even if their
score is zero or feedback is unavailable. Legacy rows without acceptance metadata
are preserved rather than guessed empty from a score or elapsed duration.

The Flutter history service applies the same exclusion to responses from the
existing backend, so the updated APK also hides earlier abandoned entries on
refresh. It follows continuation cursors past filtered pages, preserves the
first request's login ownership and detects repeated cursors. Hiding entries
does not delete their stored records or change daily interview quotas.

Regression coverage includes the exact first-question/manual-End sequence,
idempotent termination without feedback publication, existing discarded entries,
real zero-score answers, legacy entries and pagination past an empty page.

Verification: 618 backend tests across 81 suites and all 269 Flutter tests passed.
The source change is local; the history Lambda has not been deployed in this task.
The client filter is deliberately compatible with its existing response.

Signed Android artifact: `output/Qlue-1.0.11-empty-history-fix.apk`, version
`1.0.11+10011`, 79,925,217 bytes. SHA-256:
`1d68db15524b744d5e9f0dd4f4f0980ccbf4eaaf98535b9e4c570b8744f15dfb`.
APK signature and 16 KB page alignment verified; the signing certificate matches
the previous review APK. All three packaged ABIs passed the artifact check.
Static analysis reports no issues. Physical-device acceptance remains pending.
The adjacent manifest records the local source and build configuration.
