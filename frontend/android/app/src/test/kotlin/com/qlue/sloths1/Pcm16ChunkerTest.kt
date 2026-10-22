package com.qlue.sloths1
import org.junit.Assert.*
import org.junit.Test
class Pcm16ChunkerTest {
    @Test fun preservesEverySampleIncludingSilenceAndFinalTail() {
        val chunker=Pcm16Chunker();val chunks=mutableListOf<ByteArray>();val offsets=mutableListOf<Long>()
        val input=ByteArray(6000){(it%251).toByte()}
        chunker.append(input.copyOfRange(0,1000),1000){b,n->chunks.add(b);offsets.add(n)}
        chunker.append(input.copyOfRange(1000,6000),5000){b,n->chunks.add(b);offsets.add(n)}
        chunker.finish{b,n->chunks.add(b);offsets.add(n)}
        assertEquals(listOf(2560,2560,880),chunks.map{it.size});assertEquals(listOf(0L,1280L,2560L),offsets)
        assertArrayEquals(input,chunks.fold(ByteArray(0)){a,b->a+b});assertEquals(3000L,chunker.samples)
    }
    @Test(expected=IllegalArgumentException::class) fun rejectsOddPcmBytes(){Pcm16Chunker().append(ByteArray(3),3){_,_->}}
    @Test(expected=IllegalArgumentException::class) fun neverRelabelsUnsupportedSampleRate(){Pcm16Chunker(48000)}
}
