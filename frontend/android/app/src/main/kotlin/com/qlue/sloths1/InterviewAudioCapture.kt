package com.qlue.sloths1

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** One foreground microphone owner. No files, service, wake lock or logging. */
class InterviewAudioCapture(private val activity: Activity, messenger: BinaryMessenger) {
    private val main = Handler(Looper.getMainLooper())
    private val control = Executors.newSingleThreadExecutor()
    private var sink: EventChannel.EventSink? = null
    @Volatile private var recorder: AudioRecord? = null
    @Volatile private var epoch = 0
    @Volatile private var foreground = true
    private var reader: Thread? = null
    private val pending = AtomicInteger(0)
    private var permissionResult: MethodChannel.Result? = null
    private val methods = MethodChannel(messenger, "qlue/interview_audio/control")
    private val events = EventChannel(messenger, "qlue/interview_audio/frames")

    init {
        events.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, eventSink: EventChannel.EventSink?) { sink = eventSink }
            override fun onCancel(arguments: Any?) { sink = null; stopNativeCapture() }
        })
        methods.setMethodCallHandler { call, result ->
            when (call.method) {
                "permission" -> {
                    if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        result.success(true)
                    } else if (permissionResult != null) {
                        result.error("permission_pending", "Microphone permission is pending", null)
                    } else {
                        permissionResult = result
                        activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 8142)
                    }
                }
                "ack" -> {
                    if (call.argument<Int>("epoch") == epoch) pending.updateAndGet { maxOf(0, it - 1) }
                    result.success(null)
                }
                "start" -> {
                    val requestedEpoch = call.argument<Int>("epoch") ?: 0
                    control.execute {
                        try {
                            stopAndJoin()
                            start(requestedEpoch)
                            main.post { result.success(null) }
                        } catch (_: Exception) {
                            runCatching { stopAndJoin() }
                            main.post { result.error("microphone_start", "Microphone capture could not start", null) }
                        }
                    }
                }
                "stop" -> control.execute {
                    try {
                        stopAndJoin()
                        main.post { result.success(null) }
                    } catch (_: Exception) {
                        main.post { result.error("microphone_stop", "Microphone capture could not stop", null) }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    fun permissionCompleted(requestCode: Int, grantResults: IntArray) {
        if (requestCode != 8142) return
        permissionResult?.success(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
        permissionResult = null
    }

    private fun start(captureEpoch: Int) {
        check(foreground)
        check(Build.VERSION.SDK_INT >= 24)
        check(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
        val minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0)
        val audio = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(maxOf(minimum, 8192)).build()
        try {
        recorder = audio // failed initialization is also released by stopAndJoin
        check(audio.state == AudioRecord.STATE_INITIALIZED && audio.sampleRate == 16000 && audio.channelCount == 1)
        epoch = captureEpoch
        pending.set(0)
        recorder = audio
        audio.startRecording()
        check(foreground)
        check(audio.recordingState == AudioRecord.RECORDSTATE_RECORDING)
        reader = Thread({
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
            var frame = 0L
            var sequence = 0
            var previousReadNs = System.nanoTime()
            val timestamp = AudioTimestamp()
            val warmup = ArrayList<Pair<Long, ByteArray>>()
            try {
                while (recorder === audio && epoch == captureEpoch) {
                    val bytes = ByteArray(1024) // exactly 512 signed little-endian mono samples
                    var read = 0
                    while (read < bytes.size && recorder === audio) {
                        val count = audio.read(bytes, read, bytes.size - read, AudioRecord.READ_BLOCKING)
                        check(count > 0 && count % 2 == 0)
                        read += count
                    }
                    if (recorder !== audio) break
                    check(read == bytes.size && audio.recordingState == AudioRecord.RECORDSTATE_RECORDING)
                    if (Build.VERSION.SDK_INT >= 29) check(audio.activeRecordingConfiguration?.isClientSilenced != true)
                    val now = System.nanoTime()
                    check(now - previousReadNs < 250_000_000L) // starvation is interruption, never silence
                    previousReadNs = now
                    warmup.add(Pair(frame, bytes))
                    frame += 512
                    val validTimestamp = audio.getTimestamp(timestamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS
                    if (!validTimestamp) { check(warmup.size <= 16); continue }
                    // Hardware capture cursor must not overrun the unread buffer.
                    check(timestamp.framePosition - frame <= audio.bufferSizeInFrames)
                    for ((firstFrame, pcm) in warmup) {
                        check(pending.incrementAndGet() <= 64) // at most 2.048s / 64 KiB of queued PCM
                        val sampleTimeUs = timestamp.nanoTime / 1000L + (firstFrame - timestamp.framePosition) * 1_000_000L / 16000L
                        val event = mapOf("epoch" to captureEpoch, "sequence" to sequence++, "firstFrame" to firstFrame,
                            "sampleTimeUs" to sampleTimeUs, "sampleRate" to 16000, "channels" to 1, "pcm" to pcm)
                        main.post { if (epoch == captureEpoch) sink?.success(event) }
                    }
                    warmup.clear()
                }
            } catch (_: Exception) {
                main.post { if (recorder === audio && epoch == captureEpoch) sink?.error("audio_interrupted", "Audio capture continuity was interrupted", null) }
            } finally {
                try { audio.stop() } catch (_: Exception) { }
                audio.release()
                if (recorder === audio) recorder = null
            }
        }, "QlueInterviewAudio").also { it.start() }
        } catch (error: Exception) {
            // Lifecycle suspension may clear the shared recorder while start
            // is still in progress; release this local allocation as well.
            try { audio.stop() } catch (_: Exception) { }
            audio.release()
            if (recorder === audio) recorder = null
            throw error
        }
    }

    private fun stopAndJoin() {
        val audio = recorder
        recorder = null
        try { audio?.stop() } catch (_: Exception) { }
        reader?.join(1000)
        check(reader?.isAlive != true)
        if (reader == null) audio?.release()
        reader = null
        pending.set(0)
    }

    fun suspendCapture() {
        foreground = false
        stopNativeCapture()
    }

    private fun stopNativeCapture() {
        // Release at the native lifecycle boundary even if Dart is suspended.
        val audio = recorder
        recorder = null
        try { audio?.stop() } catch (_: Exception) { }
    }

    fun resumeForeground() { foreground = true }

    fun close() {
        suspendCapture()
        control.execute { stopAndJoin(); control.shutdown() }
        methods.setMethodCallHandler(null)
        events.setStreamHandler(null)
    }
}
