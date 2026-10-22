import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import boundary from '../../tests/helpers/documentBoundary.js';
import {Store} from '../src/store.mjs';
class DB extends boundary.DocumentBoundary {
  key(table,item){return table==='asr'?JSON.stringify([table,item.pk]):super.key(table,item);}
}
function setup(limit=2){
 const db=new DB(),now=1760000000000;
 db.seed('asr',{pk:'CONTROL',rolloutEnabled:true,globalStreamSlots:2,dailyStreamLimit:limit});
 db.seed('asr',{pk:'DAY#'+Math.floor(now/86400000),count:1000});
 const store=new Store(db,{table:'asr',sessions:'sessions',deletions:'deletions',now:()=>now,slots:2,dailyLimit:limit});
 function ticket(uid){
  const value=randomBytes(32).toString('base64url'),streamId=randomBytes(8).toString('hex');
  db.seed('sessions',{sessionId:uid,userId:uid,currentState:'USER_RESPONDING',lastTurnPayload:{turnId:'question'}});
  db.seed('asr',{pk:'TICKET#'+createHash('sha256').update(value).digest('hex'),userId:uid,sessionId:uid,turnId:'question',streamId,expiresAt:now/1000+30,streamExpiresAt:now/1000+180});
  return value;
 }
 return {db,store,ticket,now};
}
test('answer stream limits belong to each user and ignore the exhausted old shared counter',async()=>{
 const {db,store,ticket,now}=setup();
 for(let i=0;i<2;i++){const t=await store.redeem(ticket('first'));await store.release(t);}
 await assert.rejects(()=>store.redeem(ticket('first')),/STREAM_DAILY_LIMIT/);
 const second=await store.redeem(ticket('second'));await store.release(second);
 const day='DAY#'+Math.floor(now/86400000);
 assert.equal(db.get('asr',{pk:day+'#USER#first'}).count,2);
 assert.equal(db.get('asr',{pk:day+'#USER#first'}).userId,'first');
 assert.equal(db.get('asr',{pk:day+'#USER#second'}).count,1);
 assert.equal(db.get('asr',{pk:day}).count,1000);
});
test('concurrent starts cannot spend beyond one owner limit or create overlapping captures',async()=>{
 const {store,ticket,db,now}=setup(1);
 const results=await Promise.allSettled([store.redeem(ticket('first')),store.redeem(ticket('first'))]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(db.get('asr',{pk:'DAY#'+Math.floor(now/86400000)+'#USER#first'}).count,1);
});

test('two replicas share the global cap and a released slot accepts a rejected ticket',async()=>{
 const {store,ticket,db,now}=setup(20);
 const replica=new Store(db,{table:'asr',sessions:'sessions',deletions:'deletions',now:()=>now,slots:2,dailyLimit:20});
 const attempts=Array.from({length:12},(_,i)=>({replica:i%2?replica:store,ticket:ticket('user-'+i)}));
 const results=await Promise.allSettled(attempts.map(a=>a.replica.redeem(a.ticket)));
 const admitted=results.filter(r=>r.status==='fulfilled');
 assert.equal(admitted.length,2);
 assert.equal(new Set(admitted.map(r=>r.value.slot)).size,2);
 const retry=attempts[results.findIndex(r=>r.status==='rejected')];
 await store.release(admitted[0].value);
 const recovered=await retry.replica.redeem(retry.ticket);
 assert.equal(recovered.slot,admitted[0].value.slot);
 await Promise.all([store.release(admitted[1].value),replica.release(recovered)]);
});

test('expired leases can be replaced and an old release cannot delete the replacement',async()=>{
 const {store,ticket,db,now}=setup(20);
 const old=await store.redeem(ticket('owner'));
 for(const pk of ['LEASE#owner','SLOT#'+old.slot])db.seed('asr',{...db.get('asr',{pk}),expiresAt:now/1000-1});
 const replacement=await store.redeem(ticket('owner'));
 await store.release(old);
 assert.equal(db.get('asr',{pk:'LEASE#owner'}).streamId,replacement.streamId);
 await store.release(replacement);
});
