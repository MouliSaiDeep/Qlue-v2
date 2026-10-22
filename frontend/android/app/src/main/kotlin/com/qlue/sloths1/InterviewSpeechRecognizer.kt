package com.qlue.sloths1

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.os.ParcelFileDescriptor
import android.media.AudioFormat
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicBoolean
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/** Same system speech service as the stable speech_to_text release. One mic
 * owner; native speech boundaries are exposed separately from text updates. */
class InterviewSpeechRecognizer(private val activity: Activity, messenger: BinaryMessenger) {
    private val methods = MethodChannel(messenger, "qlue/platform_speech/control")
    private val events = EventChannel(messenger, "qlue/platform_speech/events")
    private var sink: EventChannel.EventSink? = null
    private var recognizer: SpeechRecognizer? = null
    private var epoch = -1
    private var foreground = true
    private var fixtureReader: ParcelFileDescriptor? = null
    private var fixtureWriter: ParcelFileDescriptor? = null
    private var fixtureThread: Thread? = null
    private var fixtureFile: File? = null
    private var fixtureStarted = AtomicBoolean(false)
    private var fixtureStopped = AtomicBoolean(false)
    private var segmentAudio: ParcelFileDescriptor? = null
    private var fixtureCaptureIndex = 0
    private var fixtureRequired = false
    private var answerRecording: AnswerAudioRecording? = null
    private val audioWorker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private fun discardAnswerAudio() {
        val previous = answerRecording; answerRecording = null
        previous?.stop(); if (previous != null) audioWorker.execute { previous.discard() }
    }

    init {
        val cache = File(activity.cacheDir, "answer-audio")
        cache.listFiles()?.filter { it.isFile && it.name.matches(Regex("[a-f0-9-]{36}\\.wav")) && it.lastModified() < System.currentTimeMillis() - 6 * 60 * 60 * 1000 }?.forEach { it.delete() }

        events.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, eventSink: EventChannel.EventSink?) { sink = eventSink }
            override fun onCancel(arguments: Any?) { cancel(); sink = null }
        })
        methods.setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "available" -> result.success(SpeechRecognizer.isRecognitionAvailable(activity))
                    "releaseForAws" -> releaseForAws { result.success(null) }
                    "prepareAnswerAudio" -> {
                        discardAnswerAudio()
                        if (Build.VERSION.SDK_INT >= 33 && !fixtureRequired && foreground) answerRecording = runCatching { AnswerAudioRecording(activity) }.getOrNull()
                        result.success(answerRecording != null)
                    }
                    "takeAnswerAudio" -> {
                        val recording = answerRecording; answerRecording = null
                        recording?.stop()
                        audioWorker.execute {
                            val data = runCatching { recording?.finish() }.getOrNull()
                            if (data == null && recording != null) recording.discard()
                            activity.runOnUiThread { result.success(data) }
                        }
                    }
                    "discardAnswerAudio" -> { discardAnswerAudio(); result.success(null) }
                    "prepareReviewFixture" -> { prepareReviewFixture(); result.success(null) }
                    "start" -> { start(call.argument<Int>("epoch") ?: error("missing epoch")); result.success(null) }
                    "stop" -> { if (call.argument<Int>("epoch") == epoch) recognizer?.stopListening(); result.success(null) }
                    "cancel" -> { if (call.argument<Int>("epoch") == epoch) cancel(); result.success(null) }
                    else -> result.notImplemented()
                }
            } catch (_: SecurityException) {
                cancel(); result.error("microphone_permission", "Microphone permission is required", null)
            } catch (_: Exception) {
                cancel(); result.error("speech_unavailable", "Speech recognition could not start", null)
            }
        }
    }

    private fun start(requestedEpoch: Int) {
        check(foreground)
        check(!fixtureRequired || fixtureReader != null)
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("microphone_permission")
        }
        cancel()
        epoch = requestedEpoch
        val current = SpeechRecognizer.createSpeechRecognizer(activity)
        recognizer = current
        var finished = false
        var hasText = false
        var fallingBack = false
        fun emit(type: String, values: Map<String, Any?> = emptyMap()) {
            if (recognizer === current && epoch == requestedEpoch && !finished) {
                reviewEvent(type, (values["text"] as? String)?.trim()?.split(Regex("\\s+"))?.count { it.isNotEmpty() } ?: 0)
                sink?.success(mapOf("epoch" to requestedEpoch, "type" to type) + values)
            }
        }
        val recording = answerRecording
        fun fallbackRecording(): Boolean {
            if (recording == null || fixtureReader != null || fallingBack || recognizer !== current || finished) return false
            fallingBack = true
            emit("recordingUnavailable")
            // Preserve any draft through Dart's existing recovery, but never
            // retry the failing recording path for this answer.
            answerRecording = null
            recording.stop()
            finished = true
            cancel()
            epoch = requestedEpoch // a subsequent cancel invalidates fallback
            audioWorker.execute {
                val released = recording.discard() // waits for the sole microphone producer
                activity.runOnUiThread {
                    if (foreground && epoch == requestedEpoch && recognizer == null) {
                        if (!released) {
                            // Fail closed: never open another microphone while
                            // an old capture thread might still own AudioRecord.
                            sink?.success(mapOf("epoch" to requestedEpoch, "type" to "error", "code" to SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS))
                        } else if (hasText) {
                            sink?.success(mapOf("epoch" to requestedEpoch, "type" to "error", "code" to SpeechRecognizer.ERROR_AUDIO))
                        } else runCatching { start(requestedEpoch) }.onFailure {
                            sink?.success(mapOf("epoch" to requestedEpoch, "type" to "error", "code" to SpeechRecognizer.ERROR_AUDIO))
                        }
                    }
                }
            }
            return true
        }
        val answerSegment = if (fixtureReader == null && Build.VERSION.SDK_INT >= 33) recording?.open {
            if (recognizer === current && epoch == requestedEpoch && !finished) {
                fallbackRecording()
            }
        } else null
        current.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { emit("ready"); feedFixture(); answerSegment?.start() }
            override fun onBeginningOfSpeech() { emit("speechStart") }
            override fun onEndOfSpeech() { emit("speechEnd") }
            override fun onRmsChanged(rmsdB: Float) {} // Loudness is not a speech detector.
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (text.isNotBlank()) hasText = true
                emit("partial", mapOf("text" to text))
            }
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                emit("final", mapOf("text" to text))
                emit("done")
                finished = true
            }
            override fun onSegmentResults(results: Bundle) {
                val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                emit("segmentFinal", mapOf("text" to text))
            }
            override fun onEndOfSegmentedSession() {
                emit("done")
                finished = true
            }
            override fun onError(error: Int) {
                if ((error == SpeechRecognizer.ERROR_AUDIO || error == SpeechRecognizer.ERROR_CLIENT) && fallbackRecording()) return
                if (error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || error == SpeechRecognizer.ERROR_NO_MATCH) {
                    // A native speech-start event can be a false positive.
                    // Dart distinguishes an empty segment from a lost draft.
                    emit("noMatch", mapOf("code" to error))
                } else {
                    emit("error", mapOf("code" to error))
                }
                finished = true
            }
        })
        // Qlue's English interview path uses Indian English even when the phone
        // UI locale is US/UK English. Do not substitute names or college names.
        val locale = "en-IN"
        current.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            if (Build.VERSION.SDK_INT >= 33) {
                // Vocabulary hints guide recognition; never rewrite an answer
                // or force a person's name after recognition.
                putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS,
                    arrayListOf("Flutter", "AWS", "Amazon Web Services", "Qlue",
                        "BTech", "Computer Science", "full stack development",
                        "hackathon", "software development"))
            }
            (fixtureReader ?: answerSegment?.reader)?.let { reader ->
                check(Build.VERSION.SDK_INT >= 33)
                val audio = ParcelFileDescriptor.dup(reader.fileDescriptor)
                segmentAudio = audio
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, audio)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, 16000)
                if (fixtureReader != null) Log.i("QlueSpeechReview", "fixtureAttached epoch=$requestedEpoch")
            }
            // Android 13+ supplies authoritative segment results. Without
            // segmented mode, this service can replace an earlier region's
            // hypothesis when speech resumes after a short pause.
            if (Build.VERSION.SDK_INT >= 33) {
                putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION,
                    RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            } else {
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 30000L)
            }
        })
    }

    private fun cancel() {
        answerRecording?.stop()
        val old = recognizer
        if (old != null) reviewEvent("cancel")
        recognizer = null
        epoch = -1
        try { old?.cancel() } finally { old?.destroy(); segmentAudio?.close(); segmentAudio = null }
    }
    private fun prepareReviewFixture() {
        // Reachable only through compile-time-gated Dart review input. Fixed
        // app-owned filenames prevent arbitrary file access through intents.
        val configured = activity.intent.getStringExtra("speech_fixtures")
            ?: activity.intent.getStringExtra("speech_fixture") ?: return
        check(activity.intent.getBooleanExtra("speech_review", false))
        check(Build.VERSION.SDK_INT >= 33)
        val names = configured.split(',')
        require(fixtureCaptureIndex < names.size)
        val name = names[fixtureCaptureIndex]
        require(name.matches(Regex("[a-z0-9-]{1,48}")))
        val directory = requireNotNull(activity.getExternalFilesDir(null))
        val file = File(directory, "$name.pcm")
        require(file.isFile && file.length() in 32000L..3200000L && file.length() % 2 == 0L)
        closeFixture()
        val pipe = ParcelFileDescriptor.createPipe()
        fixtureReader = pipe[0]
        fixtureWriter = pipe[1]
        fixtureFile = file
        fixtureRequired = true
        if (fixtureCaptureIndex == 0) File(directory, "speech-review-events.txt").writeText("")
        reviewEvent("capture${fixtureCaptureIndex + 1}")
        fixtureCaptureIndex++
        fixtureStarted.set(false)
        fixtureStopped.set(false)
    }
    private fun reviewEvent(type: String, words: Int = 0) {
        if (fixtureFile == null) return
        // Review fixtures only: timing/counts survive disabled Android logcat.
        // No recognized words or customer identifiers are recorded here.
        runCatching {
            File(requireNotNull(activity.getExternalFilesDir(null)), "speech-review-events.txt")
                .appendText("${android.os.SystemClock.elapsedRealtime()} $type epoch=$epoch words=$words\n")
        }
    }
    private fun feedFixture() {
        val file = fixtureFile ?: return
        val writer = fixtureWriter ?: return
        if (!fixtureStarted.compareAndSet(false, true)) return
        fixtureThread = Thread {
            try {
                FileInputStream(file).use { input ->
                    ParcelFileDescriptor.AutoCloseOutputStream(writer).use { output ->
                        val chunk = ByteArray(640) // 20 ms, mono PCM16 at 16 kHz.
                        var bytes = 0L
                        val started = android.os.SystemClock.elapsedRealtime()
                        while (!fixtureStopped.get()) {
                            val count = input.read(chunk)
                            if (count < 0) break
                            val due = started + bytes * 1000 / 32000
                            val wait = due - android.os.SystemClock.elapsedRealtime()
                            if (wait > 0) Thread.sleep(wait)
                            output.write(chunk, 0, count)
                            bytes += count
                        }
                        Log.i("QlueSpeechReview", "fixtureFinished bytes=$bytes")
                    }
                }
            } catch (_: Exception) {
                if (!fixtureStopped.get()) Log.i("QlueSpeechReview", "fixtureFeedFailed")
            }
        }.also { it.name = "qlue-review-fixture"; it.start() }
    }
    private fun closeFixture() {
        fixtureStopped.set(true)
        fixtureThread?.interrupt()
        fixtureThread = null
        fixtureWriter?.close(); fixtureWriter = null
        fixtureReader?.close(); fixtureReader = null
        fixtureFile = null
    }
    fun suspendCapture() {
        discardAnswerAudio()
        foreground = false; cancel(); closeFixture()
    }
    fun resumeForeground() { foreground = true }
    fun releaseForAws(complete: () -> Unit) {
        val recording=answerRecording;answerRecording=null
        cancel();recording?.stop()
        audioWorker.execute { recording?.discard();activity.runOnUiThread(complete) }
    }
    fun close() {
        discardAnswerAudio()
        cancel(); closeFixture(); methods.setMethodCallHandler(null); events.setStreamHandler(null); sink = null
        audioWorker.shutdown()
    }
}
