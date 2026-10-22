package com.qlue.sloths1

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.media.audiofx.AudioEffect
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import com.konovalov.vad.webrtc.VadWebRTC
import com.konovalov.vad.webrtc.config.FrameSize
import com.konovalov.vad.webrtc.config.Mode
import com.konovalov.vad.webrtc.config.SampleRate

/** Dedicated AWS path, available on API24+. No recognizer audio injection. */
class AwsPcmCapture(private val activity: Activity, messenger: BinaryMessenger,
                    private val releaseSystem: (()->Unit)->Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val methods = MethodChannel(messenger,"qlue/aws_pcm/control")
    private val events = EventChannel(messenger,"qlue/aws_pcm/frames")
    private var sink: EventChannel.EventSink? = null
    private val pending = AtomicInteger(0)
    @Volatile private var recorder: AudioRecord? = null
    @Volatile private var epoch = -1
    @Volatile private var running = false
    @Volatile private var foreground = true
    @Volatile private var closed = false
    private var reader: Thread? = null
    @Volatile private var faulted = false
    private val manager = activity.getSystemService(AudioManager::class.java)
    @Volatile private var focus: AudioManager.OnAudioFocusChangeListener? = null
    private class AudioInput(val audio: AudioRecord, val echo: AcousticEchoCanceler?,
                             val noise: NoiseSuppressor?, val vad: VadWebRTC?) {
        fun release() {
            runCatching { vad?.close() }; runCatching { echo?.release() }
            runCatching { noise?.release() }; runCatching { audio.release() }
        }
    }
    private var prepared: AudioInput? = null // idle allocation; never recording
    private val expirePrepared = Runnable {
        if (!closed) runCatching { worker.execute { releasePrepared() } }
    }
    init {
        events.setStreamHandler(object: EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, eventSink: EventChannel.EventSink?) { sink=eventSink }
            override fun onCancel(arguments: Any?) { interrupt("audio_consumer_detached"); sink=null }
        })
        methods.setMethodCallHandler { call,result ->
            when(call.method) {
                "available" -> result.success(Build.VERSION.SDK_INT>=24 && foreground)
                "prepare" -> worker.execute {
                    try {
                        check(foreground && !closed)
                        if (!running && prepared == null) prepared = allocate()
                        main.post {
                            main.removeCallbacks(expirePrepared)
                            if (foreground && !closed) main.postDelayed(expirePrepared, 30000)
                            result.success(null)
                        }
                    } catch(_:Exception) { main.post { result.error("audio_prepare_failed","Audio preparation unavailable",null) } }
                }
                "ack" -> { if(call.argument<Int>("epoch")==epoch) pending.updateAndGet { maxOf(0,it-1) };result.success(null) }
                "start" -> {
                    val requested=call.argument<Int>("epoch") ?: -1
                    // System recognizer cancellation and recording release complete
                    // before this microphone owner is allocated.
                    releaseSystem { worker.execute {
                        try { stopAndJoin();start(requested);main.post {result.success(null)} }
                        catch(_:SecurityException){main.post {result.error("microphone_permission","Microphone permission is required",null)}}
                        catch(_:Exception){runCatching {stopAndJoin()};main.post {result.error("audio_start_failed","PCM capture could not start",null)}}
                    } }
                }
                "stop", "cancel" -> worker.execute {
                    try { if(call.argument<Int>("epoch")==epoch) stopAndJoin();main.post {result.success(null)} }
                    catch(_:Exception){main.post {result.error("audio_stop_failed","Microphone could not stop",null)}}
                }
                else -> result.notImplemented()
            }
        }
    }
    private fun emit(type:String, capture:Int, values:Map<String,Any> = emptyMap()) {
        main.post { if(epoch==capture) sink?.success(mapOf("type" to type,"epoch" to capture)+values) }
    }
    private fun allocate(): AudioInput {
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw SecurityException()
        val minimum=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)
        check(minimum>0)
        fun build(source: Int): AudioRecord {
            val candidate = AudioRecord.Builder().setAudioSource(source)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(maxOf(minimum*2,10240)).build()
            if (candidate.state != AudioRecord.STATE_INITIALIZED) {
                candidate.release(); error("audio_source_unavailable")
            }
            return candidate
        }
        val audio = try { build(MediaRecorder.AudioSource.VOICE_COMMUNICATION) }
                    catch(_:Exception) { build(MediaRecorder.AudioSource.VOICE_RECOGNITION) }
        var echo: AcousticEchoCanceler? = null
        var noise: NoiseSuppressor? = null
        try {
            check(audio.state==AudioRecord.STATE_INITIALIZED && audio.sampleRate==16000 && audio.channelCount==1 && audio.audioFormat==AudioFormat.ENCODING_PCM_16BIT)
            echo = runCatching { if(AcousticEchoCanceler.isAvailable()) enableEffect(AcousticEchoCanceler.create(audio.audioSessionId)) else null }.getOrNull()
            noise = runCatching { if(NoiseSuppressor.isAvailable()) enableEffect(NoiseSuppressor.create(audio.audioSessionId)) else null }.getOrNull()
            val vad = runCatching { VadWebRTC(SampleRate.SAMPLE_RATE_16K, FrameSize.FRAME_SIZE_320, Mode.AGGRESSIVE) }.getOrNull()
            return AudioInput(audio,echo,noise,vad)
        } catch(error:Exception) {
            runCatching { echo?.release() }; runCatching { noise?.release() }; audio.release(); throw error
        }
    }
    private fun <T: AudioEffect> enableEffect(effect: T?): T? {
        if (effect == null) return null
        return try { effect.enabled=true; effect }
               catch(_:Exception) { runCatching { effect.release() }; null }
    }
    private fun releasePrepared() { prepared?.release(); prepared=null }
    private fun start(capture:Int) {
        check(foreground && capture>0 && sink!=null)
        main.removeCallbacks(expirePrepared)
        val input = prepared?.also { prepared=null } ?: allocate()
        val audio = input.audio
        try {
            check(audio.state==AudioRecord.STATE_INITIALIZED && audio.sampleRate==16000 && audio.channelCount==1 && audio.audioFormat==AudioFormat.ENCODING_PCM_16BIT)
            val listener=AudioManager.OnAudioFocusChangeListener { change ->
                if(epoch==capture && (change==AudioManager.AUDIOFOCUS_LOSS || change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT))interrupt("audio_focus_lost")
            }
            focus=listener
            @Suppress("DEPRECATION")
            check(manager.requestAudioFocus(listener,AudioManager.STREAM_MUSIC,AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)==AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
            epoch=capture;pending.set(0);faulted=false;recorder=audio;running=true
            var initialRoute=0
            audio.addOnRoutingChangedListener({ source ->
                if(recorder!==audio || !running)return@addOnRoutingChangedListener
                val id=source.routedDevice?.id ?: 0
                if(initialRoute==0)initialRoute=id else if(id!=initialRoute)interrupt("audio_route_changed")
            },main)
            audio.startRecording();check(foreground && running && audio.recordingState==AudioRecord.RECORDSTATE_RECORDING)
            emit("ready",capture,mapOf("sampleRate" to 16000,"channels" to 1,"bits" to 16,
                "echoCancellation" to (input.echo?.enabled==true), "noiseSuppression" to (input.noise?.enabled==true),
                "localVad" to (input.vad!=null)))
            reader=Thread({
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO)
                val chunks=Pcm16Chunker();val scratch=ByteArray(2560);val stamp=AudioTimestamp()
                var readSamples=0L;var last=System.nanoTime();var sequence=0
                fun send(bytes:ByteArray,offset:Long,speech:Boolean?,suppressed:Int) {
                    check(pending.incrementAndGet()<=20) {"audio_backpressure"}
                    var clipped=0;var power=0.0
                    for(i in bytes.indices step 2){val sample=((bytes[i].toInt() and 255) or (bytes[i+1].toInt() shl 8)).toShort().toInt();power+=sample.toDouble()*sample;if(kotlin.math.abs(sample)>=32760)clipped++}
                    val rms=kotlin.math.sqrt(power/(bytes.size/2))/32768
                    emit("pcm",capture,mapOf("pcm" to bytes,"offsetSamples" to offset,"sequence" to sequence++,"sampleRate" to 16000,
                        "capturedAtUs" to System.nanoTime()/1000,"clippedSamples" to clipped,"rms" to rms,
                        "suppressedSamples" to suppressed) + (speech?.let { mapOf("speech" to it) } ?: emptyMap()))
                }
                val gate = input.vad?.let { vad -> SpeechNoiseGate { samples -> vad.isSpeech(samples) } }
                val emitFrame = { bytes:ByteArray, offset:Long, speech:Boolean, suppressed:Int -> send(bytes,offset,speech,suppressed) }
                val processFrame = { bytes:ByteArray, offset:Long ->
                    if(gate!=null) gate.append(bytes,offset,emitFrame) else send(bytes,offset,null,0)
                }
                try {
                    while(running && recorder===audio) {
                        val count=audio.read(scratch,0,scratch.size,AudioRecord.READ_BLOCKING)
                        if(!running && count<=0)break
                        check(count>0 && count%2==0)
                        val now=System.nanoTime();if(running)check(now-last<300000000L) {"audio_gap"};last=now
                        readSamples+=count/2
                        if(audio.getTimestamp(stamp,AudioTimestamp.TIMEBASE_MONOTONIC)==AudioRecord.SUCCESS)
                            check(stamp.framePosition-readSamples<=audio.bufferSizeInFrames) {"audio_overrun"}
                        if(Build.VERSION.SDK_INT>=29)check(audio.activeRecordingConfiguration?.isClientSilenced!=true) {"audio_muted"}
                        if(!faulted)chunks.append(scratch,count,processFrame)
                        check(readSamples<=180*16000) {"audio_duration_limit"}
                    }
                    if(!faulted) { chunks.finish(processFrame); gate?.finish(emitFrame) }
                }catch(error:Exception){faulted=true;emit("error",capture,mapOf("code" to (error.message?.takeIf {it.startsWith("audio_")}?:"audio_capture_interrupted")))}
                finally {running=false;runCatching {audio.stop()};input.release();if(recorder===audio)recorder=null;if(epoch==capture)relinquishFocus()}
            },"qlue-aws-pcm").also {it.start()}
        }catch(error:Exception){running=false;input.release();recorder=null;relinquishFocus();throw error}
    }
    private fun stopAndJoin(){
        running=false;runCatching{recorder?.stop()};reader?.join(1500)
        check(reader?.isAlive!=true);reader=null
        relinquishFocus()
        // Posted after every final PCM frame, before the method completion.
        emit("stopped",epoch)
    }
    private fun relinquishFocus(){
        val previous=focus;focus=null
        @Suppress("DEPRECATION")
        previous?.let {manager.abandonAudioFocus(it)}
    }
    private fun interrupt(code:String){if(!running)return;faulted=true;emit("error",epoch,mapOf("code" to code));running=false;runCatching{recorder?.stop()};relinquishFocus()}
    fun suspendCapture(){foreground=false;interrupt("audio_backgrounded");main.removeCallbacks(expirePrepared);worker.execute { releasePrepared() }}
    fun resumeForeground(){foreground=true}
    fun close(){closed=true;suspendCapture();worker.execute{runCatching{stopAndJoin()};worker.shutdown()};methods.setMethodCallHandler(null);events.setStreamHandler(null)}
}
