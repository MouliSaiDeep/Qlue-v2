package com.qlue.sloths1

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var interviewAudio: InterviewAudioCapture? = null
    private var interviewSpeech: InterviewSpeechRecognizer? = null
    private var awsPcm: AwsPcmCapture? = null
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "qlue/speech_review")
            .setMethodCallHandler { call, result ->
                if (call.method == "enabled") result.success(intent.getBooleanExtra("speech_review", false) &&
                    !intent.getBooleanExtra("speech_review_interview", false))
                else result.notImplemented()
            }
        interviewAudio = InterviewAudioCapture(this, flutterEngine.dartExecutor.binaryMessenger)
        interviewSpeech = InterviewSpeechRecognizer(this, flutterEngine.dartExecutor.binaryMessenger)
        awsPcm = AwsPcmCapture(this, flutterEngine.dartExecutor.binaryMessenger) { complete ->
            interviewSpeech?.releaseForAws(complete) ?: complete()
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        interviewAudio?.permissionCompleted(requestCode, grantResults)
    }
    override fun onPause() {
        awsPcm?.suspendCapture()
        interviewAudio?.suspendCapture()
        interviewSpeech?.suspendCapture()
        super.onPause()
    }
    override fun onResume() {
        super.onResume()
        interviewAudio?.resumeForeground()
        interviewSpeech?.resumeForeground()
        awsPcm?.resumeForeground()
    }
    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        awsPcm?.close(); awsPcm = null
        interviewAudio?.close()
        interviewSpeech?.close()
        interviewAudio = null
        interviewSpeech = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
