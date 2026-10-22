package com.qlue.sloths1

/** PCM16 LE mono only. Preserve every sample, including silence. */
class Pcm16Chunker(val sampleRate: Int = 16000) {
    init { require(sampleRate == 16000) }
    private val pending = ByteArray(2560)
    private var used = 0
    var samples = 0L
        private set
    fun append(bytes: ByteArray, count: Int, emit: (ByteArray, Long) -> Unit) {
        require(count in 0..bytes.size && count % 2 == 0)
        var position = 0
        while (position < count) {
            val take = minOf(2560 - used, count - position)
            bytes.copyInto(pending, used, position, position + take)
            used += take; position += take
            if (used == 2560) { emit(pending.copyOf(), samples); samples += 1280; used = 0 }
        }
    }
    fun finish(emit: (ByteArray, Long) -> Unit) {
        if (used > 0) { emit(pending.copyOf(used), samples); samples += used / 2; used = 0 }
    }
}
