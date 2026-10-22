import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioQueue,Transcript,configuration,normalize,frame,transcribeInput} from '../src/protocol.mjs';
import {wavPcm,realtimeAudio} from '../evaluation/wav.mjs';
import {wer,confidenceUsefulness,percentiles,technicalTerms} from '../evaluation/metrics.mjs';
const result=(id,partial,text,items=[])=>({ResultId:id,IsPartial:partial,StartTime:0,EndTime:1,Alternatives:[{Transcript:text,Items:items}]});
test('null and true zero confidence stay distinct; punctuation excluded; Stable does not imply final',()=>{
  const s=normalize(result('a',false,'hello, world',[{Type:'pronunciation',Content:'hello',Confidence:0,Stable:false},{Type:'punctuation',Content:','},{Type:'pronunciation',Content:'world',Stable:true}]),{});
  assert.equal(s.words.length,2);assert.equal(s.words[0].confidence,0);assert.equal(s.words[1].confidence,null);
  assert.equal(s.words[0].stable,false);assert.equal(s.words[1].stable,true);
  const t=new Transcript();t.put(s);assert.deepEqual(t.summary().mean,0);assert.equal(t.summary().missing,1);
});
test('partial replacement preserves intentional repeated words, immutable finals and unfinished diagnostics',()=>{
  const t=new Transcript();t.put(normalize(result('a',true,'I'),{}));t.put(normalize(result('a',true,'I I know'),{}));
  assert.equal(t.text,'');t.put(normalize(result('a',false,'I I know'),{}));t.put(normalize(result('a',true,'wrong'),{}));
  t.put(normalize(result('b',true,'unfinished'),{}));assert.equal(t.text,'I I know');assert.equal(t.unfinished[0].text,'unfinished');
});
test('audio queues are bounded, preserve silence and drain before completion',async()=>{
  const q=new AudioQueue(5120);q.push(Buffer.alloc(2560));q.push(Buffer.alloc(2560));assert.throws(()=>q.push(Buffer.alloc(2)),/BACKPRESSURE/);
  q.end();let count=0;for await(const x of q){assert.equal(x.AudioEvent.AudioChunk.length,2560);count++;}assert.equal(count,2);
});
test('streaming configuration defaults to stabilization off, explicit language and actual format',()=>{
  const config=configuration({sampleRate:16000});assert.equal(config.language,'en-IN');
  assert.equal(transcribeInput(config,[]).EnablePartialResultsStabilization,undefined);
  assert.equal(transcribeInput({...config,stability:'low'},[]).PartialResultsStability,'low');
  assert.throws(()=>configuration({sampleRate:48000}),/SAMPLE_RATE/);assert.throws(()=>configuration({sampleRate:16000,stability:'automatic'}));
});
test('binary frame sequence and sample offset expose gaps; short final chunk only',()=>{
  const b=Buffer.alloc(2572);b.writeUInt32LE(3);b.writeBigUInt64LE(3840n,4);
  assert.equal(frame(b,3,3840).length,2560);assert.throws(()=>frame(b,2,3840),/AUDIO_GAP/);
  assert.throws(()=>frame(b,3,4000),/AUDIO_GAP/);assert.throws(()=>frame(b.subarray(0,100),3,3840));
  assert.equal(frame(b.subarray(0,100),3,3840,{tail:true}).length,88);
});
function wav(rate=16000,channels=1){const b=Buffer.alloc(44+6000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2*channels,28);b.writeUInt16LE(2*channels,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(6000,40);return b;}
test('WAV parser removes headers and rejects incorrect labels/formats; chunks preserve all samples',async()=>{
  const pcm=wavPcm(wav());assert.equal(pcm.length,6000);
  assert.throws(()=>wavPcm(wav(48000)),/16000/);assert.throws(()=>wavPcm(wav(16000,2)),/16000/);
  assert.throws(()=>wavPcm(wav().subarray(0,50)),/WAV/);
  const parts=[];for await(const x of realtimeAudio(pcm,{pace:false}))parts.push(x.AudioEvent.AudioChunk);
  assert.deepEqual(parts.map(p=>p.length),[2560,2560,880]);assert.deepEqual(Buffer.concat(parts),pcm);
});
test('WER reports substitutions, insertions and missing words, without expanding acronyms or numbers',()=>{
  assert.equal(wer('I use Flutter','I use flutter.').wer,0);
  assert.equal(wer('a b c','a x').substitutions,1);assert.equal(wer('a b c','a x').deletions,1);
  assert.equal(wer('a','a b c').insertions,2);assert.equal(wer('a','a b c').wer,2);
  assert.notEqual(wer('two AWS','2 A W S').wer,0);
  // Indic vowel marks are part of the word, not punctuation to discard.
  assert.notEqual(wer('नमस्ते','नमस्त').wer,0);
});
test('confidence diagnostics report missing/deletion coverage and do not manufacture calibration',()=>{
  const result=confidenceUsefulness('I use Flutter now',[{text:'I',confidence:1},{text:'use',confidence:null},{text:'flitter',confidence:0}]);
  assert.equal(result.missing,1);assert.equal(result.flaggedErrors,1);assert.equal(result.deletionsWithoutScores,1);assert.equal(result.calibrated,false);
  assert.equal(percentiles([1,2]).p95,null);assert.equal(percentiles(Array.from({length:100},(_,i)=>i+1)).p95,95);
  assert.equal(technicalTerms('I use DynamoDB','I use Dynamo DB',[{term:'DynamoDB',aliases:['Dynamo DB']}])[0].recognized,true);
});
