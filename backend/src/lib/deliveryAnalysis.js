// Objective delivery evidence, never an emotion/confidence classifier.
const path=require('node:path');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {remaining}=require('./deadline');
const MODEL_SHA='6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396';
const SAMPLE_RATE=16000, FRAME=512;
let runtime, sessionPromise;
function segments(value,totalSamples){
 if(value===undefined)return null; // Old APKs cannot prove continuity.
 if(!Array.isArray(value)||!value.length||value.length>32||value.some(n=>!Number.isInteger(n)||n<=0)||value.reduce((a,b)=>a+b,0)!==totalSamples)throw new Error('INVALID_CAPTURE_SEGMENTS');
 return [...value];
}
async function model(){
 if(!sessionPromise){
  runtime=require('onnxruntime-node');
  const file=process.env.DELIVERY_VAD_MODEL||path.resolve(__dirname,'../../layers/delivery/models/silero_vad.onnx');
  if(createHash('sha256').update(readFileSync(file)).digest('hex')!==MODEL_SHA)throw new Error('VAD_MODEL_CHANGED');
  sessionPromise=runtime.InferenceSession.create(file,{executionProviders:['cpu'],intraOpNumThreads:1,interOpNumThreads:1,enableCpuMemArena:false});
  sessionPromise.catch(()=>{sessionPromise=null;});
 }
 return sessionPromise;
}
const round=n=>Math.round(n*100)/100;
function summarize(streams){
 let speech=0,window=0,boundary=0,clipped=0,samples=0,speechEnergy=0,speechSamples=0,quietEnergy=0,quietSamples=0;
 const pauses=[];
 for(const frames of streams){
  const rawRuns=[];let start=null,active=false;
  for(let i=0;i<frames.length;i++){
   const f=frames[i];clipped+=f.clipped;samples+=f.samples;
   const voiced=f.probability>=(active?0.35:0.5);
   if(voiced){if(start===null)start=i;active=true;}
   else if(start!==null){rawRuns.push([start,i-1]);start=null;active=false;}
  }
  if(start!==null)rawRuns.push([start,frames.length-1]);
  // Bridge sub-250ms detector flicker before dropping isolated short bursts.
  const merged=[];
  for(const run of rawRuns){const previous=merged.at(-1);if(previous&&frames[run[0]].start-frames[previous[1]].end<0.25)previous[1]=run[1];else merged.push([...run]);}
  const runs=merged.filter(([a,b])=>frames[b].end-frames[a].start>=0.25);
  if(!runs.length){boundary+=frames.at(-1)?.end||0;continue;}
  const first=runs[0][0],last=runs.at(-1)[1];
  window+=frames[last].end-frames[first].start;
  boundary+=frames[first].start+(frames.at(-1).end-frames[last].end);
  runs.forEach(([a,b],r)=>{
   speech+=frames[b].end-frames[a].start;
   for(let i=a;i<=b;i++){speechEnergy+=frames[i].rms**2*frames[i].samples;speechSamples+=frames[i].samples;}
   if(r){const previous=runs[r-1][1],gap=frames[a].start-frames[previous].end;
    if(gap>=0.5){pauses.push(gap);for(let i=previous+1;i<a;i++){quietEnergy+=frames[i].rms**2*frames[i].samples;quietSamples+=frames[i].samples;}}
   }
  });
 }
 const quality={clippedSamplePercent:round(samples?100*clipped/samples:0),
  // This is recording contrast between VAD regions, not a calibrated SNR.
  recordingContrastDb:speechSamples&&quietSamples&&quietEnergy>0?round(10*Math.log10((speechEnergy/speechSamples)/(quietEnergy/quietSamples))):null};
 const limitations=streams.length>1?['CAPTURE_GAPS_EXCLUDED']:[];
 if(speech<1)return {detector:'silero-v5',status:'UNAVAILABLE',reason:speech?'INSUFFICIENT_DETECTED_SPEECH':'NO_DETECTED_SPEECH',captureSegmentCount:streams.length,...quality,limitations};
 return {detector:'silero-v5',status:'AVAILABLE',speechSeconds:round(speech),responseWindowSeconds:round(window),
  internalPauseCount:pauses.length,internalPauseSeconds:round(pauses.reduce((a,b)=>a+b,0)),longestInternalPauseSeconds:round(Math.max(0,...pauses)),
  excludedBoundarySilenceSeconds:round(boundary),captureSegmentCount:streams.length,...quality,limitations};
}
async function analyze(bytes,boundaries){
 const sizes=segments(boundaries,(bytes.length-44)/2);
 if(!sizes)return {detector:'silero-v5',status:'UNAVAILABLE',reason:'CAPTURE_CONTINUITY_UNKNOWN',limitations:['CAPTURE_CONTINUITY_UNKNOWN']};
 const s=await model(),streams=[];let offset=0;
 for(const size of sizes){
  // Each capture restart is a fresh recurrent stream. Missing time is never inserted.
  let state=new runtime.Tensor('float32',new Float32Array(256),[2,1,128]);
  let context=new Float32Array(64);const frames=[];
  for(let at=0;at<size;at+=FRAME){
   if(remaining()<5000)throw new Error('VAD_DEADLINE');
   const input=new Float32Array(576);input.set(context);const count=Math.min(FRAME,size-at);let energy=0,clipped=0;
   for(let j=0;j<count;j++){const sample=bytes.readInt16LE(44+2*(offset+at+j))/32768;input[64+j]=sample;energy+=sample*sample;if(Math.abs(sample)>=0.999)clipped++;}
   const outputs=await s.run({input:new runtime.Tensor('float32',input,[1,576]),state,sr:new runtime.Tensor('int64',BigInt64Array.of(16000n),[])});
   const probability=Number(outputs.output.data[0]);if(!Number.isFinite(probability)||probability<0||probability>1)throw new Error('INVALID_VAD_OUTPUT');
   state=outputs.stateN;context=input.slice(-64);
   frames.push({start:at/SAMPLE_RATE,end:(at+count)/SAMPLE_RATE,probability,rms:Math.sqrt(energy/count),clipped,samples:count});
  }
  streams.push(frames);offset+=size;
 }
 return summarize(streams);
}
function transcriptMarkers(text){
 if(typeof text!=='string')return {recognizedFillers:null,recognizedImmediateRepeats:null};
 const words=text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)||[];
 return {recognizedFillers:words.filter(w=>['um','uh','erm','hmm'].includes(w)).length,
  recognizedImmediateRepeats:words.filter((w,i)=>i>0&&w===words[i-1]).length};
}
function eligible(a){
 const d=a.delivery;if(d?.status!=='AVAILABLE')return [];
 const quality=d.clippedSamplePercent>=1||(d.recordingContrastDb!==null&&d.recordingContrastDb<6);
 // Thresholds only flag measurement reliability; they do not grade a person.
 if(quality)return ['RECORDING_QUALITY'];
 const codes=['REVIEW_PACE'];if(d.internalPauseCount>0)codes.push('PAUSE_PLANNING');if(a.recognizedFillers>0)codes.push('FILLER_REVIEW');if(a.recognizedImmediateRepeats>0)codes.push('REPEATED_WORD_REVIEW');
 return codes;
}
function promptEvidence(measurements){return (measurements?.answers||[]).slice(0,20).map(a=>({answerNumber:a.answerNumber,delivery:a.delivery||{status:'UNAVAILABLE'},
 recognizedWordsPerResponseMinute:a.recognizedWordsPerResponseMinute??null,recognizedFillers:a.recognizedFillers??null,recognizedImmediateRepeats:a.recognizedImmediateRepeats??null,allowedFocus:eligible(a)}));}
function coaching(raw,measurements){
 if(raw?.confidence!==undefined||!Array.isArray(raw?.deliveryFindings)||raw.deliveryFindings.length>20)return [];
 const seen=new Set(),out=[];
 for(const finding of raw.deliveryFindings){
  if(!finding||Object.keys(finding).some(k=>!['answerNumber','focus'].includes(k)))continue;
  const a=measurements?.answers?.find(x=>x.answerNumber===finding.answerNumber);
  if(!a||seen.has(a.answerNumber)||!eligible(a).includes(finding.focus))continue;
  const d=a.delivery;let text;
  switch(finding.focus){
   case 'PAUSE_PLANNING':text=`Detected ${d.internalPauseCount} internal pause(s) of at least 0.5 seconds, totaling ${d.internalPauseSeconds.toFixed(1)} seconds. Review whether these were useful thinking pauses; practice one point per breath if they interrupted your explanation.`;break;
   case 'FILLER_REVIEW':text=`The recognized text contains ${a.recognizedFillers} filler token(s), such as “um” or “uh”. Check the transcript for recognition mistakes before practicing a brief silent pause instead.`;break;
   case 'REPEATED_WORD_REVIEW':text=`The received text contains ${a.recognizedImmediateRepeats} immediate repeated word(s). These may be recognition artifacts. Check the transcript first; if the repetitions reflect what you said, practice stating each point once.`;break;
   case 'RECORDING_QUALITY':text=`Recording quality needs review: ${d.clippedSamplePercent.toFixed(2)}% clipped samples${d.recordingContrastDb===null?'':`, ${d.recordingContrastDb.toFixed(1)} dB speech/non-speech contrast`}. Try a quieter recording or microphone placement check. This is not a judgement of your delivery.`;break;
   case 'REVIEW_PACE':if(!Number.isFinite(a.recognizedWordsPerResponseMinute))continue;text=`The recognized-text pace was ${a.recognizedWordsPerResponseMinute} words/min across the captured response window. In your next practice answer, check whether key ideas are easy to follow; there is no universal ideal pace.`;break;
  }
  seen.add(a.answerNumber);out.push({answerNumber:a.answerNumber,focus:finding.focus,text});
 }
 return out;
}
module.exports={analyze,summarize,segments,transcriptMarkers,promptEvidence,coaching,MODEL_SHA};
