// Explicit paid AWS evaluation only. Never enabled by the application flag.
import fs from 'node:fs/promises';
import path from 'node:path';
import { TranscribeStreamingClient,StartStreamTranscriptionCommand } from '@aws-sdk/client-transcribe-streaming';
import { TranscribeClient } from '@aws-sdk/client-transcribe';
import { Vocabularies } from '../src/vocabulary.mjs';
import { Transcript,normalize,configuration,transcribeInput } from '../src/protocol.mjs';
import { wavPcm,realtimeAudio } from './wav.mjs';
import { wer,technicalTerms,confidenceUsefulness,percentiles } from './metrics.mjs';
const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
if(!args.includes('--aws')||!args.includes('--manifest')||!args.includes('--output'))throw Error('Use --aws --manifest consented-recordings.json --output ignored-report.json');
const manifestPath=path.resolve(get('--manifest')),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
if(!Array.isArray(manifest.recordings)||!manifest.recordings.length)throw Error('NO_RECORDINGS');
const speakers=new Map();
for(const r of manifest.recordings){
  if(r.consented!==true||typeof r.speakerId!=='string'||!r.speakerId||!['calibration','evaluation'].includes(r.split))throw Error('CONSENT_AND_SPEAKER_SPLIT_REQUIRED');
  if(speakers.has(r.speakerId)&&speakers.get(r.speakerId)!==r.split)throw Error('SPEAKER_LEAKAGE');speakers.set(r.speakerId,r.split);
}
const client=new TranscribeStreamingClient({region:'us-east-1',maxAttempts:1}),reports=[];
const vocabularyClient=new TranscribeClient({region:'us-east-1',maxAttempts:1});
const vocabularies=new Vocabularies(vocabularyClient,manifest.vocabularyManifest??{});
try{
  for(const r of manifest.recordings){
    const pcm=wavPcm(await fs.readFile(path.resolve(path.dirname(manifestPath),r.wav)));
    const config=configuration({sampleRate:16000,language:r.language??'en-IN',stability:r.stability??'off'});
    const vocabulary=await vocabularies.choose(r.topic??'general',config.language);
    if(vocabulary.applied)config.vocabulary=vocabulary.requested;
    const collector=new Transcript(),lags=[];let firstPartial=null,firstAudioAt=null,failed=null;
    const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),200000);
    try{
      const result=await client.send(new StartStreamTranscriptionCommand(transcribeInput(config,realtimeAudio(pcm,{onFirstAudio:at=>{firstAudioAt=at;}}))),{abortSignal:abort.signal});
      for await(const event of result.TranscriptResultStream){for(const raw of event.TranscriptEvent?.Transcript?.Results??[]){
        const segment=normalize(raw,{streamId:'evaluation',epoch:1,offsetSamples:0,...config});if(!segment)continue;
        collector.put(segment);const elapsed=firstAudioAt===null?null:performance.now()-firstAudioAt;
        if(segment.partial&&segment.text&&firstPartial===null)firstPartial=elapsed;
        if(!segment.partial&&segment.end!==null&&elapsed!==null)lags.push(elapsed-segment.end*1000);
      }}
    }catch(error){failed=error.name;}finally{clearTimeout(timeout);}
    const comparable=!failed&&!collector.unfinished.length&&r.humanVerified===true&&typeof r.reference==='string';
    reports.push({recordingId:r.id,split:r.split,speakerId:r.speakerId,device:r.device,accent:r.accent,headset:r.headset,noise:r.noise,
      config,vocabulary,durationSeconds:pcm.length/32000,estimatedBillableSeconds:Math.ceil(pcm.length/32000),failed,unfinished:collector.unfinished,
      transcript:collector.text,confidence:collector.summary(),firstPartialMs:firstPartial,estimatedFinalLagMs:lags,
      accuracy:comparable?{aws:wer(r.reference,collector.text),system:typeof r.systemHypothesis==='string'?wer(r.reference,r.systemHypothesis):null,
        terms:technicalTerms(r.reference,collector.text,manifest.technicalTerms??[]),confidenceUsefulness:confidenceUsefulness(r.reference,collector.ordered(true).flatMap(s=>s.words))}:null});
  }
}finally{client.destroy();vocabularyClient.destroy();}
const evaluation=reports.filter(r=>r.split==='evaluation');
const paired=evaluation.filter(r=>r.accuracy?.system&&r.accuracy?.aws);
const errors=s=>s.substitutions+s.deletions+s.insertions;
const referenceWords=paired.reduce((n,r)=>n+r.accuracy.aws.referenceWords,0);
const awsWer=referenceWords?paired.reduce((n,r)=>n+errors(r.accuracy.aws),0)/referenceWords:null;
const systemWer=referenceWords?paired.reduce((n,r)=>n+errors(r.accuracy.system),0)/referenceWords:null;
await fs.writeFile(path.resolve(get('--output')),JSON.stringify({region:'us-east-1',normalization:'NFKC lowercase; punctuation/apostrophes ignored; numbers/acronyms NOT expanded',
  thresholdCalibrated:false,accuracyImprovementEstablished:false,fullConversationLatencyMeasured:false,
  pairedComparison:{recordings:paired.length,referenceWords,awsWer,systemWer,descriptiveImprovementObserved:awsWer!==null&&systemWer!==null?awsWer<systemWer:null},
  firstPartialMs:percentiles(evaluation.map(r=>r.firstPartialMs)),estimatedFinalLagMs:percentiles(evaluation.flatMap(r=>r.estimatedFinalLagMs)),reports},null,2)+'\n');
console.info(JSON.stringify({recordings:reports.length,humanReferenced:reports.filter(r=>r.accuracy).length,outputWritten:true,rolloutEnabled:false}));
