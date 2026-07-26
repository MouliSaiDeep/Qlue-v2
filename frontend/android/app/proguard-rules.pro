# R8 is enabled for release builds. Flutter, Firebase and the plugins used here
# are reflection-heavy in places, so keep the entry points R8 cannot see.

# Flutter engine embedding
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-dontwarn io.flutter.embedding.**

# Firebase (Auth, Messaging, Core) — model classes are constructed reflectively
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# speech_to_text uses the platform recognizer service via reflection
-keep class android.speech.** { *; }

# just_audio / ExoPlayer
-keep class com.google.android.exoplayer2.** { *; }
-dontwarn com.google.android.exoplayer2.**

# Keep annotations and generic signatures so JSON/reflection paths keep working
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
