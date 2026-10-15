import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    id("com.google.gms.google-services")
}

// Release signing credentials live in android/key.properties, which is
// gitignored. When it is present the APK/AAB is signed with the real upload
// key and is uploadable to Play / publishable to GitHub Releases.
//
// When it is absent, a release build FAILS by default (fail-closed): a
// debug-signed release artifact cannot be updated in place by existing users
// (Android rejects the install), and silently producing one is exactly the
// footgun that breaks the public APK channel. For a purely local check such as
// `flutter run --release`, opt in to the debug fallback explicitly with
// `-Pqlue.allowDebugReleaseSigning=true`; that artifact must never be shipped.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}
val allowDebugReleaseSigning =
    (project.findProperty("qlue.allowDebugReleaseSigning") as String?)?.toBoolean() ?: false

android {
    namespace = "com.qlue.sloths1"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.qlue.sloths1"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            // A release build signed with the debug keystore is rejected by the
            // Play Store AND breaks in-place updates for users on a real-signed
            // build, so we fail closed: supply android/key.properties (the stable
            // upload keystore) before building a release. Only a local check may
            // opt into debug signing via -Pqlue.allowDebugReleaseSigning=true.
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else if (allowDebugReleaseSigning) {
                logger.warn(
                    "WARNING: android/key.properties not found — signing the release build " +
                    "with the DEBUG keystore because -Pqlue.allowDebugReleaseSigning=true was set. " +
                    "This artifact is for local use only and MUST NOT be published."
                )
                signingConfigs.getByName("debug")
            } else {
                throw GradleException(
                    "Release build requires android/key.properties (the stable upload keystore). " +
                    "Publishing a debug-signed APK breaks in-place updates for existing users, so " +
                    "release signing is mandatory by default. For a throwaway local build, pass " +
                    "-Pqlue.allowDebugReleaseSigning=true (never ship that artifact)."
                )
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}

flutter {
    source = "../.."
}

// Experimental offline recognition is unreachable from main.dart. Keep its
// tooling dependency, but omit its unused JNI libraries in production.
// Never exclude libc++_shared.so: other plugins can depend on it.
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        variant.packaging.jniLibs.excludes.addAll(
            listOf(
                "**/libonnxruntime.so",
                "**/libsherpa-onnx-c-api.so",
                "**/libsherpa-onnx-cxx-api.so"
            )
        )
    }
}
