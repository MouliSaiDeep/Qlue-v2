# Profile and history update — 22 October 2026

Appearance now sits under App Preferences, below Voice Model. The former upper Account section is removed. Reset Password sits directly above Delete Account in the remaining bottom Account section, with the existing authenticated reset and deletion dialogs preserved.

History cards now use a 250ms entrance animation and a 30ms stagger capped at 120ms. Previously, every successive card added another 100ms before a 600ms fade, so later cards could remain invisible for seconds. Reduced Motion skips the card animation. This change accelerates card presentation after data arrives; it does not change API fetching or add backend requests.

Static analysis of both modified screens passed. All 27 existing password-reset and profile checks passed, including opening the reset and delete-account dialogs from the rearranged profile. Physical-device appearance and timing remain for the user's APK check.

No backend deployment, commit, push or GitHub release is part of this update. The app version remains 1.0.9+10009, and the existing AWS transcription and automatic answer submission build settings are retained.

Signed APK: `output/Qlue-1.0.9-profile-history.apk` (79,908,829 bytes). SHA-256: `28c645bdb516f8798ea4109225f087f5e33bf0c9631e2ab8f59f6ba0c1a0217a`. Release build, APK signature verification and 16KiB zip alignment passed. Package `com.qlue.sloths1`, version name `1.0.9`, version code `10009`; signing certificate SHA-256 matches the existing app: `cfc3985705e59dbbdc940bfc2f25b3ff1f9202cd369170dd3ffcc9f4ee2c3dcd`.
