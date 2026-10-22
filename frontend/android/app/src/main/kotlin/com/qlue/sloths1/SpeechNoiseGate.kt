package com.qlue.sloths1

/** Local VAD gating, with 160ms pre-roll and 240ms tail to retain word edges.
 * Non-speech is zero-filled, never removed: sample offsets and timing survive.
 * The classifier consumes 20ms of PCM16 mono at 16kHz on the audio thread.
 */
class SpeechNoiseGate(private val classify: (ShortArray) -> Boolean) {
    private data class Frame(val pcm: ByteArray, val offset: Long, val speech: Boolean, var keep: Boolean)
    private val pending = java.util.ArrayDeque<Frame>()
    private var tail = 0

    fun append(pcm: ByteArray, offset: Long, emit: (ByteArray, Long, Boolean, Int) -> Unit) {
        require(pcm.isNotEmpty() && pcm.size <= 2560 && pcm.size % 2 == 0)
        var positive = 0
        var frames = 0
        for (start in pcm.indices step 640) {
            val samples = ShortArray(320)
            for (i in 0 until minOf(320, (pcm.size - start) / 2)) {
                samples[i] = ((pcm[start + i * 2].toInt() and 255) or
                    (pcm[start + i * 2 + 1].toInt() shl 8)).toShort()
            }
            if (classify(samples)) positive++
            frames++
        }
        // Isolated 20ms clicks must not extend the four-second answer boundary.
        val speech = positive >= minOf(2, frames)
        pending.addLast(Frame(pcm, offset, speech, speech || tail > 0))
        if (speech) {
            pending.forEach { it.keep = true }
            tail = 3
        } else if (tail > 0) tail--
        if (pending.size > 2) send(pending.removeFirst(), emit)
    }

    fun finish(emit: (ByteArray, Long, Boolean, Int) -> Unit) {
        while (pending.isNotEmpty()) send(pending.removeFirst(), emit)
    }

    private fun send(frame: Frame, emit: (ByteArray, Long, Boolean, Int) -> Unit) {
        emit(if (frame.keep) frame.pcm else ByteArray(frame.pcm.size), frame.offset,
            frame.speech, if (frame.keep) 0 else frame.pcm.size / 2)
    }
}
