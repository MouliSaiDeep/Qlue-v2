export function wavPcm(bytes){
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('INVALID_WAV');
  let fmt,pcm;
  for(let at=12;at+8<=bytes.length;){
    const name=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8;
    if(start+size>bytes.length)throw Error('TRUNCATED_WAV');
    if(name==='fmt '){if(fmt||size<16)throw Error('INVALID_WAV_FORMAT');fmt=bytes.subarray(start,start+size);}
    if(name==='data'){if(pcm)throw Error('MULTIPLE_WAV_DATA_CHUNKS');pcm=bytes.subarray(start,start+size);}
    at=start+size+(size%2);
  }
  if(!fmt||!pcm||pcm.length%2||fmt.readUInt16LE(0)!==1||fmt.readUInt16LE(2)!==1||fmt.readUInt32LE(4)!==16000||
    fmt.readUInt32LE(8)!==32000||fmt.readUInt16LE(12)!==2||fmt.readUInt16LE(14)!==16)throw Error('REQUIRES_PCM16_MONO_16000');
  if(pcm.length>180*32000)throw Error('RECORDING_TOO_LONG');return pcm;
}
export async function* realtimeAudio(pcm,{pace=true,onFirstAudio=()=>{}}={}){
  const started=performance.now();
  for(let at=0;at<pcm.length;at+=2560){
    const wait=started+at/32-performance.now();if(pace&&wait>0)await new Promise(r=>setTimeout(r,wait));
    if(at===0)onFirstAudio(performance.now());
    yield {AudioEvent:{AudioChunk:pcm.subarray(at,Math.min(at+2560,pcm.length))}};
  }
}
