# Reproducible releases

The source toolchain is Flutter 3.41.2 / Dart 3.11.0 and Node.js 24. Use lockfiles
and the checked-in CI workflows. `frontend/env.json`, Firebase platform files
and signing credentials remain private local/CI inputs.

## Reviewable source

The working tree already contained extensive changes before the public-launch
work. Review and commit source in focused changes: transport/admission, frontend,
evaluation, CI/release tools, and documentation. Do not bulk-stage investigation
folders, screenshots, customer transcripts, private snapshots or APKs. New
production files must be included in the reviewed source revision.

From a clean checkout, install dependencies and run the commands in the root
README. Frontend CI also rejects unexpected changes to `pubspec.lock` after
dependency resolution. Backend all-source coverage floors are 55% statements,
48% branches, 55% functions and 58% lines. They are regression floors with a small
buffer below the measured baseline, not a quality certification.

## Build configuration

Copy `frontend/env.example.json` to `frontend/env.json`. Configure the intended
API, Firebase client values and voice flags. The example keeps AWS STT off.
Enabling it in an APK also requires the ticket endpoint, gateway and shared
CONTROL record to admit it. Never silently replace the installed release's
configuration with example defaults.

Supply `frontend/android/app/google-services.json` for Android Firebase and the
existing release signing key through the project's private local/CI setup.
Changing that key prevents existing installations from updating in place.

Every distributed build needs a distinct, increasing Android version code.
The tag workflow derives it from `major*10000 + minor*100 + patch`; keep minor
and patch below 100 with that encoding. Increase the version before distributing
a changed build. Do not overwrite an existing release APK with new bytes.

```powershell
cd frontend
flutter build apk --release --dart-define-from-file=env.json --dart-define=SPEECH_REVIEW=false --build-name=1.0.10 --build-number=10010
cd ..
node audit/release-manifest.cjs --require-clean --tag v1.0.10 --speech-review false --config frontend/env.json --artifact frontend/build/app/outputs/flutter-apk/app-release.apk --output tmp/release-manifest.json
```

The example version is illustrative, not a release created by this work. The
manifest records the Git revision, source fingerprint, declared pubspec version,
configuration fingerprint and actual APK digest/size. It never publishes config
values or signing material. `--require-clean` rejects modified/untracked release
inputs; omit it only for explicitly labelled local review manifests.
Tags must match the version and encoded build number in `pubspec.yaml`. The
manifest rejects oversized version components, leading zeroes and prerelease
suffixes under the current encoding. The explicit speech-review override is
recorded separately from the config file fingerprint.

The tag workflow publishes `Qlue.apk` and `Qlue-manifest.json` after its checks.
Verify the APK signature, package identity, version code, alignment and manifest
hashes before distribution. A manifest identifies build inputs; the signature
and verified build process remain necessary to establish artifact trust.

## Backend rollout

Use the canonical SAM application template and the appropriate audio hosting
template. Inspect the complete change set, confirm provider quotas, notify the
operator and run owned synthetic acceptance after deployment. Preserve source
artifacts and the prior configuration for rollback. Deploy consumers before
producers when changing queued payload contracts.

The existing backend workflow validates/builds; it does not automatically deploy.
The public-launch changes do not deploy, push commits, create tags or publish an APK.
