import { performance } from 'node:perf_hooks';
import { StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { AudioQueue,Transcript,configuration,normalize,transcribeInput,frame } from './protocol.mjs';
// No per-chunk Lambda/SQS/storage work: one bounded in-memory queue per stream.
export function attach(ws,{store,transcribe,vocabularies,enabled=false,drainMs=8000,pollMs=2000,onMetric=()=>{},onAuthenticated=()=>{}}) {
  const abort=new AbortController(),audio=new AudioQueue(),text=new Transcript();
  let t,tail=false,normalEnd=false,cancelled=false,finished=false,sequence=0,nextOffset=0,totalBytes=0,firstAudioAt=null;
  let expiry,poll,drain,ping,authTimer,checking=false,started=false;
  const began=performance.now(),metrics={firstPartialMs:null,finalDelivery:[],receivedBytes:0,discontinuities:0,clippedSamples:0};
  const send=value=>{if(ws.readyState!==1)throw Error('CLIENT_DISCONNECTED');if(ws.bufferedAmount>128000)throw Error('RESULT_BACKPRESSURE');ws.send(JSON.stringify(value));};
  const close=(code=1008)=>{if(ws.readyState<2)ws.close(code);};
  let ending,work;
  async function finish(error){
    if(ending)return ending;
    ending=(async()=>{
      finished=true;audio.end();abort.abort();
      for(const timer of [expiry,poll,drain,ping,authTimer])clearTimeout(timer);
      const reason=/^[A-Z0-9_]{1,80}$/.test(error?.message??'')?error.message:'TRANSCRIBE_UNAVAILABLE';
      const status=normalEnd&&!error&&!text.unfinished.length?'FINISHED':cancelled?'CANCELLED':'INTERRUPTED';
      if(t){
        try{
          await store.finish(t,{status,text:text.text,confidence:text.summary(),unfinished:text.unfinished,
            segments:text.ordered(true),
            nextOffsetSamples:nextOffset,vocabulary:t.vocabulary??{applied:false},measurements:{...metrics,receivedBytes:totalBytes,totalMs:performance.now()-began}});
          if(status==='FINISHED')send({type:'complete',streamId:t.streamId,epoch:t.epoch,originalTranscript:text.text,confidence:text.summary(),nextOffsetSamples:nextOffset});
          else if(ws.readyState===1)send({type:'interrupted',streamId:t.streamId,epoch:t.epoch,reason:error?reason:'UNFINISHED_SEGMENTS',
            finalizedText:text.text,unfinished:text.unfinished,nextOffsetSamples:nextOffset,requiresConfirmation:true});
        }catch(error){
          metrics.evidencePersistenceError=/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error?.name??'')?error.name:'UnknownError';
          if(ws.readyState===1)try{send({type:'error',code:'ASR_PERSISTENCE_UNAVAILABLE'});}catch{}
        }
        finally{try{await store.release(t);}catch{ /* Lease expires; no unsafe takeover. */ }}
      }else if(ws.readyState===1)try{send({type:'error',code:reason});}catch{}
      onMetric({status:metrics.evidencePersistenceError?'PERSISTENCE_FAILED':status,authenticated:Boolean(t),...metrics,receivedBytes:totalBytes,totalMs:performance.now()-began}); // No UID, token, text or audio in logs.
      close(status==='FINISHED'?1000:1011);
    })();return ending;
  }
  async function begin(message){
    if(started)throw Error('DUPLICATE_START');started=true;
    if(!enabled)throw Error('AWS_STT_DISABLED');
    if(message.type!=='start'||message.protocol!==1)throw Error('INVALID_START');
    t=await store.redeem(message.ticket);nextOffset=t.offsetSamples;onAuthenticated();
    if(finished){
      try{await store.finish(t,{status:'INTERRUPTED',text:'',confidence:text.summary(),unfinished:[],segments:[],nextOffsetSamples:nextOffset,vocabulary:{applied:false},measurements:{receivedBytes:0}});}
      finally{await store.release(t);}return;
    }
    const config=configuration(t);t.vocabulary=await vocabularies.choose(t.topic,t.language);
    if(t.vocabulary.applied)config.vocabulary=t.vocabulary.requested;
    if(finished){await store.release(t);return;}
    clearTimeout(authTimer);
    expiry=setTimeout(()=>finish(Error('STREAM_EXPIRED')),Math.max(1,t.streamExpiresAt*1000-Date.now()));
    // Authorization is checked during silence as well as speech, across replicas.
    poll=setInterval(async()=>{if(checking||finished)return;checking=true;try{await store.authorize(t);}catch{await finish(Error('STREAM_AUTHORIZATION_ENDED'));}finally{checking=false;}},pollMs);
    ping=setInterval(()=>{if(ws.readyState===1)ws.ping();},15000);
    const identity={streamId:t.streamId,epoch:t.epoch,sessionId:t.sessionId,turnId:t.turnId,captureId:t.captureId,language:t.language,offsetSamples:t.offsetSamples};
    send({type:'ready',...identity,sampleRate:16000,chunkBytes:2560,streamExpiresAt:t.streamExpiresAt,vocabulary:t.vocabulary,replayBoundary:t.offsetSamples});
    const result=await transcribe.send(new StartStreamTranscriptionCommand(transcribeInput(config,audio)),{abortSignal:abort.signal});
    for await(const event of result.TranscriptResultStream){
      if(finished)break;
      if(event.BadRequestException||event.InternalFailureException||event.LimitExceededException)throw Error('TRANSCRIBE_STREAM_FAILED');
      for(const raw of event.TranscriptEvent?.Transcript?.Results??[]){
        const segment=normalize(raw,identity);if(!segment)continue;text.put(segment);
        if(text.text.length>10000)throw Error('TRANSCRIPT_LIMIT');
        const observed=performance.now();
        if(segment.partial&&segment.text&&metrics.firstPartialMs===null&&firstAudioAt!==null)metrics.firstPartialMs=observed-firstAudioAt;
        if(!segment.partial&&segment.end!==null&&firstAudioAt!==null)metrics.finalDelivery.push({endSeconds:segment.end,estimatedLagMs:observed-firstAudioAt-segment.end*1000});
        send(segment);
      }
    }
    if(!normalEnd)throw Error('UPSTREAM_ENDED_EARLY');
    await finish();
  }
  authTimer=setTimeout(()=>finish(Error('TICKET_TIMEOUT')),5000);
  ws.on('message',(data,binary)=>{
    if(finished)return;
    try{
      if(binary){
        if(!t||!expiry||normalEnd||tail)throw Error('AUDIO_OUTSIDE_CAPTURE');
        // A short final chunk is allowed exactly once; nothing may follow it.
        tail=data.length<2572;
        const pcm=frame(data,sequence,nextOffset,{tail});
        if(totalBytes+pcm.length>180*32000)throw Error('AUDIO_DURATION_LIMIT');
        if(firstAudioAt===null)firstAudioAt=performance.now();
        // Permit a small scheduling burst, but never accept faster-than-live replay.
        if(totalBytes+pcm.length>(performance.now()-firstAudioAt+2000)*32)throw Error('AUDIO_RATE_LIMIT');
        audio.push(pcm);sequence++;totalBytes+=pcm.length;nextOffset+=pcm.length/2;
        for(let i=0;i<pcm.length;i+=2)if(Math.abs(pcm.readInt16LE(i))>=32760)metrics.clippedSamples++;
        send({type:'ack',sequence:sequence-1,nextOffsetSamples:nextOffset});
      }else{
        if(data.length>4096)throw Error('CONTROL_LIMIT');
        const message=JSON.parse(data.toString());
        if(message.type==='start'){
          if(started)throw Error('DUPLICATE_START');
          work=begin(message).catch(finish);
        }
        else if(message.type==='end'&&t&&!normalEnd){
          if(message.nextOffsetSamples!==nextOffset||message.frames!==sequence)throw Error('AUDIO_GAP');
          normalEnd=true;audio.end();drain=setTimeout(()=>finish(Error('FINALIZATION_TIMEOUT')),drainMs);
        }else if(message.type==='cancel'){cancelled=true;void finish(Error('CAPTURE_CANCELLED'));}
        else throw Error('INVALID_CONTROL');
      }
    }catch(error){void finish(error);}
  });
  ws.on('close',()=>{if(!finished)void finish(Error('CLIENT_DISCONNECTED'));});
  ws.on('error',()=>{void finish(Error('CLIENT_DISCONNECTED'));});
  return {
    get authenticated(){return Boolean(t);},
    stop:async()=>{await finish(Error('GATEWAY_DRAINING'));await work;},
    // Includes redemption that was already in flight when the socket closed.
    get done(){return Promise.allSettled([ending,work]);}
  };
}
