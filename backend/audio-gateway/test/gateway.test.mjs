import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {attach} from '../src/gateway.mjs';
const t={userId:'owner',streamId:'stream',sessionId:'session',captureId:'capture',turnId:'question',epoch:1,language:'en-IN',stability:'off',sampleRate:16000,offsetSamples:0,streamExpiresAt:Math.floor(Date.now()/1000)+180};
const speech=(partial=false)=>({TranscriptEvent:{Transcript:{Results:[{ResultId:'same-id',IsPartial:partial,StartTime:0,EndTime:.08,Alternatives:[{Transcript:'I I know',Items:[{Type:'pronunciation',Content:'I',Confidence:0}]}]}]}}});
async function setup({unfinished=false,hang=false,enabled=true,drainMs=50,authorizationEnded=false,redeemGate,persistenceError}={}){
  const saved=[],releases=[],metrics=[];
  let entered;const admissionStarted=new Promise(resolve=>{entered=resolve;});
  const store={redeem:async ticket=>{if(ticket!=='valid')throw Error('INVALID_TICKET');entered();await redeemGate;return {...t};},authorize:async()=>{if(authorizationEnded)throw Error('ended');},finish:async(ticket,result)=>{if(persistenceError)throw persistenceError;saved.push(result);},release:async ticket=>releases.push(ticket)};
  const transcribe={send:async command=>({TranscriptResultStream:(async function*(){
    for await(const _ of command.input.AudioStream){if(unfinished){yield speech(true);break;}}
    if(hang)await new Promise(()=>{});else if(!unfinished)yield speech();
  })()})};
  const server=http.createServer(),wss=new WebSocketServer({server}),connections=[];
  wss.on('connection',ws=>connections.push(attach(ws,{store,transcribe,enabled,drainMs,pollMs:10,vocabularies:{choose:async()=>({applied:false})},onMetric:m=>metrics.push(m)})));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}`),events=[];
  ws.on('message',data=>events.push(JSON.parse(data)));await once(ws,'open');
  async function wait(type){const end=Date.now()+2000;do{const e=events.find(e=>e.type===type);if(e)return e;await new Promise(r=>setTimeout(r,5));}while(Date.now()<end);throw Error('Missing event '+type);}
  return {ws,events,saved,releases,metrics,connections,admissionStarted,wait,close:async()=>{ws.terminate();wss.clients.forEach(s=>s.terminate());await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));}};
}
const binary=()=>Buffer.alloc(2572);
test('one answer streams through one SDK call, drains and persists authoritative finals before complete',async()=>{
  const c=await setup();try{
    c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'valid'}));await c.wait('ready');
    c.ws.send(binary());await c.wait('ack');c.ws.send(JSON.stringify({type:'end',frames:1,nextOffsetSamples:1280}));
    const done=await c.wait('complete');assert.equal(done.originalTranscript,'I I know');assert.equal(c.saved[0].status,'FINISHED');assert.equal(c.saved[0].confidence.mean,0);assert.equal(c.releases.length,1);
  }finally{await c.close();}
});
test('failed evidence persistence never reports completion or logs error messages with transcript data',async()=>{
  const error=Object.assign(Error('private transcript must not enter metrics'),{name:'ValidationException'});
  const c=await setup({persistenceError:error});try{
    c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'valid'}));await c.wait('ready');c.ws.send(binary());await c.wait('ack');c.ws.send(JSON.stringify({type:'end',frames:1,nextOffsetSamples:1280}));
    assert.equal((await c.wait('error')).code,'ASR_PERSISTENCE_UNAVAILABLE');assert.equal(c.events.some(e=>e.type==='complete'),false);
    await c.connections[0].done;
    assert.equal(c.metrics[0].status,'PERSISTENCE_FAILED');assert.equal(c.metrics[0].evidencePersistenceError,'ValidationException');
    assert.equal(JSON.stringify(c.metrics).includes('private transcript'),false);assert.equal(c.releases.length,1);
  }finally{await c.close();}
});
test('unfinalized speech is explicitly interrupted and cannot be reported complete',async()=>{
  const c=await setup({unfinished:true});try{c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'valid'}));await c.wait('ready');c.ws.send(binary());
    await c.wait('interrupted');assert.equal(c.events.some(e=>e.type==='complete'),false);assert.equal(c.saved[0].unfinished.length,1);
  }finally{await c.close();}
});
test('bounded finalization timeout preserves diagnostics rather than grading an unfinished answer',async()=>{
  const c=await setup({hang:true});try{c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'valid'}));await c.wait('ready');c.ws.send(binary());await c.wait('ack');c.ws.send(JSON.stringify({type:'end',frames:1,nextOffsetSamples:1280}));
    assert.equal((await c.wait('interrupted')).reason,'FINALIZATION_TIMEOUT');assert.equal(c.saved[0].status,'INTERRUPTED');
  }finally{await c.close();}
});
test('audio gaps and incorrect end boundaries fail visibly',async()=>{
  const c=await setup();try{c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'valid'}));await c.wait('ready');const b=binary();b.writeBigUInt64LE(1280n,4);c.ws.send(b);
    assert.equal((await c.wait('interrupted')).reason,'AUDIO_GAP');
  }finally{await c.close();}
});
test('shared authorization is polled during capture and termination releases capacity',async()=>{
  const c=await setup({authorizationEnded:true});try{c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'valid'}));await c.wait('ready');assert.equal((await c.wait('interrupted')).reason,'STREAM_AUTHORIZATION_ENDED');assert.equal(c.releases.length,1);
  }finally{await c.close();}
});
test('disabled rollout and wrong tickets never start paid transcription',async()=>{
  for(const options of [{enabled:false},{}]){const c=await setup(options);try{c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'wrong'}));await c.wait('error');assert.equal(c.saved.length,0);}finally{await c.close();}}
});

test('disconnect during redemption remains in the drain until evidence and leases are released',async()=>{
  let release;const redeemGate=new Promise(resolve=>{release=resolve;});
  const c=await setup({redeemGate});
  try{
    c.ws.send(JSON.stringify({type:'start',protocol:1,ticket:'valid'}));await c.admissionStarted;
    c.ws.close();await once(c.ws,'close');
    let drained=false;const done=c.connections[0].done.then(()=>{drained=true;});
    await new Promise(r=>setTimeout(r,10));assert.equal(drained,false);
    release();await done;
    assert.equal(c.saved[0].status,'INTERRUPTED');assert.equal(c.releases.length,1);
    assert.equal(c.events.some(e=>e.type==='ready'),false);
  }finally{release();await c.close();}
});
