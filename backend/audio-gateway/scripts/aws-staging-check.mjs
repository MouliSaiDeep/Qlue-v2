// Creates/removes only new synthetic tables. No production changes, IAM changes,
// gateway deployment, human audio, vocabularies or feature activation.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {DynamoDBClient,CreateTableCommand,DeleteTableCommand,waitUntilTableExists} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,PutCommand,GetCommand} from '@aws-sdk/lib-dynamodb';
import {TranscribeStreamingClient,StartStreamTranscriptionCommand} from '@aws-sdk/client-transcribe-streaming';
import {Store} from '../src/store.mjs';
import {realtimeAudio} from '../evaluation/wav.mjs';
if(!process.argv.includes('--apply'))throw Error('Use --apply to authorize isolated AWS checks and one billable silence stream');
const prefix='qlue-stt-test-'+crypto.randomBytes(6).toString('hex'),created=[],checks=[];
const raw=new DynamoDBClient({region:'us-east-1',maxAttempts:1,requestHandler:{connectionTimeout:5000,requestTimeout:15000}}),db=DynamoDBDocumentClient.from(raw);
const names={table:prefix+'-asr',sessions:prefix+'-sessions',deletions:prefix+'-deletions'};
const store=new Store(db,{...names,slots:2,dailyLimit:10});
const put=(table,item)=>db.send(new PutCommand({TableName:table,Item:item}));
async function ticket(uid,{expiresAt=Math.floor(Date.now()/1000)+30,turnId='question'}={}){
  const token=crypto.randomBytes(32).toString('base64url'),streamId=crypto.randomBytes(16).toString('hex');
  await put(names.sessions,{sessionId:uid,userId:uid,currentState:'USER_RESPONDING',lastTurnPayload:{turnId:'question'}});
  await put(names.table,{pk:'TICKET#'+crypto.createHash('sha256').update(token).digest('hex'),userId:uid,sessionId:uid,turnId,captureId:'capture',epoch:1,streamId,expiresAt,
    streamExpiresAt:Math.floor(Date.now()/1000)+180,offsetSamples:0,language:'en-IN',stability:'off',sampleRate:16000});return token;
}
let error;
try{
  for(const [name,key] of [[names.table,'pk'],[names.sessions,'sessionId'],[names.deletions,'userId']]){
    await raw.send(new CreateTableCommand({TableName:name,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:key,AttributeType:'S'}],KeySchema:[{AttributeName:key,KeyType:'HASH'}],Tags:[{Key:'purpose',Value:'qlue-stt-isolated-validation'}]}));created.push(name);
    await waitUntilTableExists({client:raw,maxWaitTime:60,minDelay:1},{TableName:name});
  }
  await put(names.table,{pk:'CONTROL',rolloutEnabled:true,globalStreamSlots:2,dailyStreamLimit:10});
  const first=await ticket('synthetic-a'),second=await ticket('synthetic-a');
  const concurrent=await Promise.allSettled([store.redeem(first),store.redeem(second)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);const owner=concurrent.find(r=>r.status==='fulfilled').value;
  checks.push('Real DynamoDB transaction admits exactly one concurrent stream per user');
  await assert.rejects(()=>store.redeem(concurrent[0].status==='fulfilled'?first:second));checks.push('Single-use ticket cannot be redeemed twice');
  const other=await store.redeem(await ticket('synthetic-b'));
  await assert.rejects(async()=>store.redeem(await ticket('synthetic-c')));checks.push('Global slot limit coordinates independent users');
  await assert.rejects(async()=>store.redeem(await ticket('expired',{expiresAt:1})));
  await assert.rejects(async()=>store.redeem(await ticket('wrong-question',{turnId:'old'})));checks.push('Expired and wrong-question tickets rejected');
  await store.finish(other,{status:'FINISHED',text:'synthetic final',confidence:{mean:null},unfinished:[],segments:[],nextOffsetSamples:0,vocabulary:{applied:false},measurements:{}});
  const persisted=await store.get('STREAM#'+other.streamId);assert.equal(persisted.status,'FINISHED');assert.equal(persisted.originalTranscript,'synthetic final');assert.deepEqual(persisted.segments,[]);
  checks.push('Real DynamoDB final evidence write and consistent read succeed');
  await put(names.deletions,{userId:owner.userId,status:'PENDING'});await assert.rejects(()=>store.authorize(owner));
  await assert.rejects(()=>store.finish(owner,{status:'FINISHED',text:'synthetic',confidence:{mean:null},unfinished:[],segments:[],nextOffsetSamples:0,vocabulary:{applied:false},measurements:{}}));
  checks.push('Deletion fence revokes streams and prevents late recognized-text persistence');
  await store.release(owner);await store.release(other);
  const limited=new Store(db,{...names,slots:2,dailyLimit:1});
  const quotaOwner=await limited.redeem(await ticket('quota-owner'));await limited.release(quotaOwner);
  await assert.rejects(async()=>limited.redeem(await ticket('quota-owner')));
  const independent=await limited.redeem(await ticket('independent-owner'));await limited.release(independent);
  checks.push('Real DynamoDB per-user daily stream guard does not consume another owner allowance');
  await put(names.table,{pk:'CONTROL',rolloutEnabled:false});await assert.rejects(async()=>store.redeem(await ticket('disabled')));checks.push('Shared kill switch is fail closed');
  const client=new TranscribeStreamingClient({region:'us-east-1',maxAttempts:1}),abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),20000);
  try{
    const result=await client.send(new StartStreamTranscriptionCommand({LanguageCode:'en-IN',MediaEncoding:'pcm',MediaSampleRateHertz:16000,AudioStream:realtimeAudio(Buffer.alloc(32000))}),{abortSignal:abort.signal});
    for await(const _ of result.TranscriptResultStream){}checks.push('Real en-IN Transcribe Streaming PCM silence request drains successfully');
  }finally{clearTimeout(timeout);client.destroy();}
}catch(e){error=e;console.error(JSON.stringify({error:e.name,message:e.message}));}
finally{
  const cleanup=await Promise.allSettled(created.map(TableName=>raw.send(new DeleteTableCommand({TableName}))));
  if(cleanup.some(r=>r.status==='rejected'))error??=Error('ISOLATED_TABLE_CLEANUP_FAILED');
  raw.destroy();
}
const result={checkedAt:new Date().toISOString(),passed:!error,checks,syntheticTablesCreated:created.length,syntheticTablesDeleteAccepted:!error,
  productionResourcesChanged:0,humanAccuracyMeasured:false,fullConversationLatencyMeasured:false,rolloutEnabled:false};
const at=process.argv.indexOf('--output');if(at>=0)await fs.writeFile(process.argv[at+1],JSON.stringify(result,null,2)+'\n');
console.info(JSON.stringify(result));if(error)process.exitCode=1;
