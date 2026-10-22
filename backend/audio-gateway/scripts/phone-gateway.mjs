// USB loopback validation only; not included in the production container.
// Reuses production ticket issuance, Store, gateway and Transcribe SDK. The
// local-only issuer represents a synthetic account, not Firebase authentication.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {WebSocketServer} from 'ws';
import {DynamoDBClient,CreateTableCommand,DeleteTableCommand,waitUntilTableExists,waitUntilTableNotExists} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,PutCommand} from '@aws-sdk/lib-dynamodb';
import {TranscribeStreamingClient} from '@aws-sdk/client-transcribe-streaming';
import {Store} from '../src/store.mjs';
import {attach} from '../src/gateway.mjs';
if(!process.argv.includes('--apply'))throw Error('Use --apply for isolated device verification with billable AWS streaming');
const prefix='qlue-stt-phone-'+crypto.randomBytes(6).toString('hex'),created=[];
const output=path.resolve('../../tmp/aws-stt-phone');await fs.mkdir(output,{recursive:true});
const raw=new DynamoDBClient({region:'us-east-1',maxAttempts:1,requestHandler:{connectionTimeout:5000,requestTimeout:15000}}),db=DynamoDBDocumentClient.from(raw);
const names={table:prefix+'-asr',sessions:prefix+'-sessions',deletions:prefix+'-deletions'};
// Persist exact resource identities before creation, so a killed terminal can
// be reconciled without guessing from a stale successful-cleanup report.
const startedAt=new Date().toISOString();
const journal=()=>fs.writeFile(path.join(output,'resources.json'),JSON.stringify({prefix,plannedTables:Object.values(names),created:[...created],startedAt},null,2));
await journal();
await fs.writeFile(path.join(output,'cleanup.json'),JSON.stringify({clean:false,requiresCleanup:true,prefix,at:startedAt},null,2));
let server,wss,shutdownStarted=false;
const active=new Set(),transcribe=new TranscribeStreamingClient({region:'us-east-1',maxAttempts:1});
async function shutdown(){
  if(shutdownStarted)return;shutdownStarted=true;
  await Promise.race([Promise.allSettled([...active].map(c=>c.stop())),new Promise(r=>setTimeout(r,10000))]);
  wss?.clients.forEach(ws=>ws.terminate());wss?.close();server?.close();
  const cleanup=await Promise.allSettled(created.map(async TableName=>{
    await raw.send(new DeleteTableCommand({TableName}));
    await waitUntilTableNotExists({client:raw,maxWaitTime:60,minDelay:1},{TableName});
  }));
  const clean=cleanup.every(x=>x.status==='fulfilled');
  await fs.writeFile(path.join(output,'cleanup.json'),JSON.stringify({clean,verifiedAbsent:clean,tables:[...created],syntheticTables:created.length,productionResourcesChanged:0,at:new Date().toISOString()},null,2));
  raw.destroy();transcribe.destroy();console.info(JSON.stringify({stopped:true,syntheticTablesCleanupAccepted:clean}));process.exit(clean?0:1);
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
// Local staging helpers must not stay available indefinitely after testing.
setTimeout(()=>void shutdown(),30*60*1000).unref();
try{
  for(const [name,key]of[[names.table,'pk'],[names.sessions,'sessionId'],[names.deletions,'userId']]){
    await raw.send(new CreateTableCommand({TableName:name,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:key,AttributeType:'S'}],KeySchema:[{AttributeName:key,KeyType:'HASH'}],Tags:[{Key:'purpose',Value:'qlue-stt-phone-validation'}]}));created.push(name);await journal();
    await waitUntilTableExists({client:raw,maxWaitTime:60,minDelay:1},{TableName:name});
  }
  await db.send(new PutCommand({TableName:names.table,Item:{pk:'CONTROL',rolloutEnabled:true,globalStreamSlots:2,dailyStreamLimit:20}}));
  await db.send(new PutCommand({TableName:names.sessions,Item:{sessionId:'synthetic-phone',userId:'synthetic-phone',moduleType:'INTRO',currentState:'USER_RESPONDING',lastTurnPayload:{turnId:'staging-question'}}}));
  Object.assign(process.env,{AWS_REGION:'us-east-1',AWS_STT_ENABLED:'true',STT_SESSIONS_TABLE:names.table,SESSIONS_TABLE:names.sessions,DELETION_JOBS_TABLE:names.deletions,STT_GATEWAY_URL:'wss://staging.invalid/audio'});
  const require=createRequire(import.meta.url),issuer=require('../../src/lib/sttSession.js');
  const store=new Store(db,{...names,slots:2,dailyLimit:20});
  let reportNumber=0;
  server=http.createServer(async(req,res)=>{
    const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    try{
      if(req.method!=='POST')return json(405,{});
      const parts=[];let size=0;for await(const p of req){size+=p.length;if(size>9000000)throw Error('REPORT_LIMIT');parts.push(p);}
      const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
      if(req.url==='/ticket'){
        const ticket=await issuer.issue('synthetic-phone',body,Math.floor(Date.now()/1000)+600);
        return json(200,{...ticket,gatewayUrl:'ws://127.0.0.1:8788/audio'});
      }
      if(req.url==='/report'){
        const number=++reportNumber,pcm=Buffer.from(body.pcmBase64??'','base64');delete body.pcmBase64;
        if(pcm.length>5760000||pcm.length%2)throw Error('INVALID_PCM');
        const wav=Buffer.alloc(44+pcm.length);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
        await fs.writeFile(path.join(output,`capture-${number}.wav`),wav);
        await fs.writeFile(path.join(output,`capture-${number}.pcm`),pcm);
        await fs.writeFile(path.join(output,`capture-${number}.json`),JSON.stringify({...body,receivedAt:new Date().toISOString(),pcmBytes:pcm.length,sampleRate:16000,channels:1,bits:16},null,2));
        console.info(JSON.stringify({event:'device-report',number,complete:body.complete,pcmBytes:pcm.length,frames:body.frames}));return json(200,{saved:true,number});
      }
      if(req.url==='/system-report'){
        await fs.writeFile(path.join(output,'system-replay.json'),JSON.stringify({...body,at:new Date().toISOString()},null,2));return json(200,{saved:true});
      }
      if(req.url==='/shutdown'){json(200,{stopping:true});void shutdown();return;}
      return json(404,{});
    }catch(e){json(e.statusCode||503,{code:e.code||'PROBE_UNAVAILABLE'});}
  });
  server.on('error',error=>{console.error(JSON.stringify({error:error.name}));void shutdown();});
  wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/audio'||shutdownStarted||active.size>=2){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>{
      const c=attach(ws,{store,transcribe,enabled:true,vocabularies:{choose:async()=>({applied:false,reason:'BASELINE_NO_VOCABULARY'})},onMetric:m=>console.info(JSON.stringify({event:'gateway-measurement',...m}))});
      active.add(c);ws.once('close',()=>{void c.done.finally(()=>active.delete(c));});
    });
  });
  server.listen(8788,'127.0.0.1',()=>console.info(JSON.stringify({ready:true,port:8788,scope:'USB-loopback-and-isolated-AWS-tables',productionRolloutEnabled:false})));
}catch(e){console.error(JSON.stringify({error:e.name}));await shutdown();}
