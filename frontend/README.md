# Qlue Flutter application

Android interview capture requires API 24+. CI uses Flutter 3.41.2 and Dart 3.11.0.
Other platform folders are scaffolding and do not establish voice capture support.

```powershell
flutter pub get
Copy-Item env.example.json env.json
# Edit env.json with the intended API/Firebase client configuration.
flutter run --dart-define-from-file=env.json
```

`env.json`, Android Firebase configuration and release signing material remain
private. Consult [build and release](../docs/RELEASES.md) for signed builds.
Compile configuration is fixed inside the APK. AWS speech is disabled in the
example and source defaults; enabled builds also need matching backend controls.

```powershell
flutter analyze --no-pub
flutter test --no-pub
```

Tests use injected services; real device acceptance is tracked separately in
[the Android checklist](../docs/DEVICE_ACCEPTANCE.md).

Interview state models live in `lib/features/interview/models/`. The provider
retains session ownership while its response-recovery part handles bounded
transport/answer retry scheduling. Profile preferences/settings widgets and
feedback presentation helpers are extracted from their screens.

See the [root overview](../README.md), [public-launch plan](../docs/PUBLIC_LAUNCH.md)
and [feedback evaluation](../docs/FEEDBACK_EVALUATION.md).
