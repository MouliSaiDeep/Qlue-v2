package com.qlue.sloths1

import org.junit.Assert.*
import org.junit.Test

class SpeechNoiseGateTest {
    @Test fun `stationary noise is silenced without changing samples or offsets`() {
        val gate = SpeechNoiseGate { false }
        val frames = mutableListOf<Pair<ByteArray, Long>>()
        val emit: (ByteArray, Long, Boolean, Int) -> Unit = { bytes, offset, speech, suppressed ->
            frames.add(bytes to offset); assertFalse(speech); assertEquals(bytes.size / 2, suppressed)
        }
        repeat(8) { gate.append(ByteArray(2560) { 27 }, it * 1280L, emit) }
        gate.append(ByteArray(320) { 27 }, 10240L, emit)
        gate.finish(emit)
        assertEquals((0L..7L).map { it * 1280 } + 10240, frames.map { it.second })
        assertEquals(20800, frames.sumOf { it.first.size })
        assertTrue(frames.all { f -> f.first.all { it == 0.toByte() } })
    }

    @Test fun `pre roll and consonant tail retained then background noise gated`() {
        var inputFrame = 0
        var subFrame = 0
        val gate = SpeechNoiseGate {
            val active = inputFrame in 3..5
            if (++subFrame == 4) { subFrame = 0; inputFrame++ }
            active
        }
        val kept = mutableListOf<Boolean>(); val activity = mutableListOf<Boolean>()
        val emit: (ByteArray, Long, Boolean, Int) -> Unit = { bytes, _, speech, _ ->
            kept.add(bytes[0] != 0.toByte()); activity.add(speech)
        }
        repeat(12) { gate.append(ByteArray(2560) { 1 }, it * 1280L, emit) }
        gate.finish(emit)
        assertEquals((0..11).map { it in 1..8 }, kept)
        assertEquals((0..11).map { it in 3..5 }, activity)
    }

    @Test fun `isolated transient does not become speech`() {
        var call = 0
        val gate = SpeechNoiseGate { ++call == 5 }
        val activity = mutableListOf<Boolean>()
        val emit: (ByteArray, Long, Boolean, Int) -> Unit = { _, _, speech, _ -> activity.add(speech) }
        repeat(5) { gate.append(ByteArray(2560), it * 1280L, emit) }; gate.finish(emit)
        assertTrue(activity.none { it })
    }
}
