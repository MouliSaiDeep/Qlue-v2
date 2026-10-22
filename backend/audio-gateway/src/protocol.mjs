export const FORMAT = Object.freeze({ sampleRate: 16000, channels: 1, bits: 16, chunkBytes: 2560 });
export function configuration(input = {}) {
  const language = input.language ?? 'en-IN', stability = input.stability ?? 'off';
  if (!['en-IN','en-US','en-GB','hi-IN'].includes(language)) throw Error('UNSUPPORTED_LANGUAGE');
  if (!['off','low','medium','high'].includes(stability)) throw Error('INVALID_STABILITY');
  if (input.sampleRate !== 16000) throw Error('INVALID_SAMPLE_RATE');
  return { language, stability, sampleRate: 16000 };
}
export function transcribeInput(config, audio) {
  return { LanguageCode: config.language, MediaEncoding: 'pcm', MediaSampleRateHertz: config.sampleRate, AudioStream: audio,
    ...(config.vocabulary ? { VocabularyName: config.vocabulary } : {}),
    ...(config.stability === 'off' ? {} : { EnablePartialResultsStabilization: true, PartialResultsStability: config.stability }) };
}
const finite = n => typeof n === 'number' && Number.isFinite(n) ? n : null;
export function normalize(result, identity) {
  const a = result.Alternatives?.[0];
  if (!a || typeof result.ResultId !== 'string') return null;
  return { type: 'transcript', provider: 'aws-transcribe', ...identity, resultId: result.ResultId,
    partial: result.IsPartial !== false, start: finite(result.StartTime), end: finite(result.EndTime), text: a.Transcript ?? '',
    words: (a.Items ?? []).filter(w => w.Type === 'pronunciation').map(w => ({ text: w.Content ?? '', start: finite(w.StartTime), end: finite(w.EndTime),
      confidence: result.IsPartial===false && finite(w.Confidence) !== null && w.Confidence >= 0 && w.Confidence <= 1 ? w.Confidence : null,
      stable: typeof w.Stable === 'boolean' ? w.Stable : null })) };
}
export class Transcript {
  segments = new Map();
  put(s) {
    const old = this.segments.get(s.resultId);
    if (old && !old.partial) return; // A final is immutable, including duplicate finals.
    if (this.segments.size >= 500 && !old) throw Error('TRANSCRIPT_LIMIT');
    this.segments.set(s.resultId,s);
  }
  ordered(finalOnly=false) { return [...this.segments.values()].filter(s=>!finalOnly||!s.partial).sort((a,b)=>(a.start??0)-(b.start??0)); }
  get text() { return this.ordered(true).map(s=>s.text).filter(Boolean).join(' '); }
  get unfinished() { return this.ordered().filter(s=>s.partial); }
  summary(threshold=.80) {
    const words=this.ordered(true).flatMap(s=>s.words),known=words.filter(w=>w.confidence!==null);
    return { label:'recognition-confidence-not-accuracy',mean:known.length?known.reduce((n,w)=>n+w.confidence,0)/known.length:null,
      words:words.length,missing:words.length-known.length,threshold,calibrated:false,
      belowThreshold:known.filter(w=>w.confidence<threshold).length,
      lowConfidenceSpans:known.filter(w=>w.confidence<threshold).slice(0,100).map(w=>({text:w.text,start:w.start,end:w.end,confidence:w.confidence})),
      lowConfidenceSpansTruncated:known.filter(w=>w.confidence<threshold).length>100 };
  }
}
export class AudioQueue {
  constructor(maxBytes=64000) { this.limit=maxBytes;this.bytes=0;this.items=[];this.waiter=null;this.ended=false; }
  push(bytes) {
    if(this.ended)throw Error('AUDIO_ENDED');
    if(this.bytes+bytes.length>this.limit)throw Error('AUDIO_BACKPRESSURE');
    const value={AudioEvent:{AudioChunk:bytes}};
    if(this.waiter){this.waiter({value,done:false});this.waiter=null;}
    else{this.items.push(bytes);this.bytes+=bytes.length;}
  }
  end(){this.ended=true;if(this.waiter){this.waiter({done:true});this.waiter=null;}}
  next(){if(this.items.length){const bytes=this.items.shift();this.bytes-=bytes.length;return Promise.resolve({value:{AudioEvent:{AudioChunk:bytes}},done:false});}
    if(this.ended)return Promise.resolve({done:true});return new Promise(resolve=>{this.waiter=resolve;});}
  [Symbol.asyncIterator](){return this;}
}
// Binary frame = uint32 sequence, uint64 absolute sample offset (both LE), PCM.
export function frame(bytes, sequence, offset, {tail=false}={}) {
  if(bytes.length<14||bytes.length>2572)throw Error('INVALID_AUDIO_FRAME');
  const pcm=bytes.subarray(12);
  if(pcm.length%2||(!tail&&pcm.length!==2560))throw Error('INVALID_PCM_CHUNK');
  if(bytes.readUInt32LE(0)!==sequence||bytes.readBigUInt64LE(4)!==BigInt(offset))throw Error('AUDIO_GAP');
  return pcm;
}
