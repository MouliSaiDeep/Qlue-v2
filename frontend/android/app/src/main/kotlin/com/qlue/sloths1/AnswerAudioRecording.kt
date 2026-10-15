package com.qlue.sloths1

import android.app.Activity
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.os.Build
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean

/** One microphone producer writes both the recognizer's pipe and a bounded WAV.
 * Nothing is logged. A provider which cannot drain the pipe disables recording
 * for this answer; recognition can recover through the original microphone path. */
class AnswerAudioRecording(private val activity: Activity) {
    val file = File(activity.cacheDir, "answer-audio/${UUID.randomUUID()}.wav")
    private val lock = Any()
    private var bytes = 0L
    @Volatile var valid = true
        private set
    private val segments = mutableListOf<Segment>()
    @Volatile private var active: Segment? = null
    init { file.parentFile?.mkdirs(); RandomAccessFile(file, "rw").use { it.setLength(44) } }

    inner class Segment(val failure: () -> Unit) {
        var writtenSamples = 0L
            private set
        private val pipe = ParcelFileDescriptor.createPipe()
        val reader = pipe[0]
        private val writer = pipe[1]
        private val running = AtomicBoolean(false)
        private val stopped = AtomicBoolean(false)
        private val queue = ArrayBlockingQueue<ByteArray>(64) // bounded 1.28s
        private var recorder: AudioRecord? = null
        private var capture: Thread? = null
        private var feed: Thread? = null
        fun start() {
            if (!running.compareAndSet(false, true) || stopped.get()) return
            try {
                val size = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                require(size > 0)
                val input = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(size * 2, 6400))
                recorder = input
                check(input.state == AudioRecord.STATE_INITIALIZED)
                input.startRecording()
                check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING)
                feed = Thread {
                    try {
                        ParcelFileDescriptor.AutoCloseOutputStream(writer).use { output ->
                            while (running.get()) { val chunk = queue.take(); output.write(chunk) }
                        }
                    } catch (_: Exception) { if (running.get()) fail() }
                }.also { it.name = "qlue-answer-pipe"; it.start() }
                capture = Thread {
                    try {
                        val chunk = ByteArray(640)
                        val timestamp = AudioTimestamp()
                        var frames = 0L
                        var previousRead = System.nanoTime()
                        RandomAccessFile(file, "rw").use { out ->
                        while (running.get()) {
                            val count = input.read(chunk, 0, chunk.size, AudioRecord.READ_BLOCKING)
                            if (!running.get()) break
                            check(count > 0 && count % 2 == 0)
                            val now = System.nanoTime()
                            check(now - previousRead < 250000000L)
                            previousRead = now; frames += count / 2
                            if (input.getTimestamp(timestamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS) {
                                check(timestamp.framePosition - frames <= input.bufferSizeInFrames)
                            }
                            if (Build.VERSION.SDK_INT >= 29) check(input.activeRecordingConfiguration?.isClientSilenced != true)
                            val written = synchronized(lock) {
                                if (!running.get() || active !== this) false else {
                                    check(valid && bytes + count <= 6400000L)
                                    out.seek(44 + bytes); out.write(chunk, 0, count)
                                    bytes += count; writtenSamples += count / 2
                                    true
                                }
                            }
                            if (!written) break
                            check(queue.offer(chunk.copyOf(count)))
                        }
                        }
                    } catch (_: Exception) { if (running.get()) fail() }
                    finally { runCatching { input.release() } }
                }.also { it.name = "qlue-answer-capture"; it.start() }
            } catch (_: Exception) { fail() }
        }
        private fun fail() {
            valid = false
            stop()
            activity.runOnUiThread(failure)
        }
        fun stop() {
            stopped.set(true); running.set(false)
            runCatching { recorder?.stop() }
            runCatching { reader.close() }; runCatching { writer.close() }
            feed?.interrupt()
        }
        fun awaitStopped(): Boolean {
            capture?.join(1000); feed?.join(1000)
            val released = capture?.isAlive != true && feed?.isAlive != true
            if (!released) valid = false
            // A start failure can happen before the capture thread owns cleanup.
            if (released) runCatching { recorder?.release() }
            return released
        }
    }
    fun open(failure: () -> Unit): Segment? {
        stop()
        if (!valid) return null
        return Segment(failure).also { active = it; segments.add(it) }
    }
    fun stop() { active?.stop(); active = null }
    // Called on the platform worker, after detaching ownership from the UI.
    fun finish(): Map<String, Any>? {
        stop(); segments.forEach { it.awaitStopped() }
        synchronized(lock) {
            if (!valid || bytes < 32000) { file.delete(); return null }
            RandomAccessFile(file, "rw").use { out ->
                fun short(v: Int) { out.writeByte(v and 255); out.writeByte((v ushr 8) and 255) }
                fun int(v: Int) { short(v and 65535); short(v ushr 16) }
                out.seek(0); out.writeBytes("RIFF"); int((bytes + 36).toInt()); out.writeBytes("WAVEfmt ")
                int(16); short(1); short(1); int(16000); int(32000); short(2); short(16)
                out.writeBytes("data"); int(bytes.toInt())
            }
            return mapOf("path" to file.absolutePath, "fileSize" to file.length(),
                "captureSegments" to segments.map { it.writtenSamples }.filter { it > 0 })
        }
    }
    fun discard(): Boolean {
        valid = false; stop()
        val released = segments.map { it.awaitStopped() }.all { it }
        synchronized(lock) { file.delete() }
        return released
    }
}
