const {DocumentBoundary}=require('../../helpers/documentBoundary');
const ddb=require('../../../src/lib/dynamodb');
const deadline=require('../../../src/lib/deadline');
const paid=require('../../../src/lib/paidWork');
const quota=require('../../../src/lib/quota');
const {mockClient}=require('aws-sdk-client-mock');
const {BedrockRuntimeClient}=require('@aws-sdk/client-bedrock-runtime');
const {PollyClient}=require('@aws-sdk/client-polly');
let db,old;
const keys=['PAID_ATTEMPT_LIMIT','USER_PAID_ATTEMPT_LIMIT','PAID_OPS_SWITCH_PARAMETER','QLUE_PAID_OPS_DISABLED'];
const day=()=>new Date().toISOString().slice(0,10);
const call=userId=>deadline.withDeadline(null,()=>paid.beforePaidCall('interview'),{userId});
beforeEach(()=>{
 old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.PAID_ATTEMPT_LIMIT='50';delete process.env.USER_PAID_ATTEMPT_LIMIT;
 delete process.env.PAID_OPS_SWITCH_PARAMETER;delete process.env.QLUE_PAID_OPS_DISABLED;
 paid.resetCache();db=new DocumentBoundary();jest.spyOn(ddb.docClient,'send').mockImplementation(c=>db.send(c));
});
afterEach(()=>{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}jest.restoreAllMocks();paid.resetCache();});

test('an exhausted system/test allowance does not block either user',async()=>{
 db.seed('qlue-usage',{userId:'BUDGET#GLOBAL',date:day(),paidAttempts:50});
 await expect(call('first')).resolves.toBeUndefined();await expect(call('second')).resolves.toBeUndefined();
 expect(db.get('qlue-usage',{userId:'first',date:day()}).paidAttempts).toBe(1);
 expect(db.get('qlue-usage',{userId:'second',date:day()}).paidAttempts).toBe(1);
 expect(db.get('qlue-usage',{userId:'BUDGET#GLOBAL',date:day()}).paidAttempts).toBe(50);
 await expect(call()).rejects.toMatchObject({code:'QUOTA_EXCEEDED',statusCode:429});
});
test('a user provider limit is atomic and cannot spend another user allowance',async()=>{
 process.env.USER_PAID_ATTEMPT_LIMIT='3';db.seed('qlue-usage',{userId:'first',date:day(),paidAttempts:2});
 const results=await Promise.allSettled([call('first'),call('first')]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect(results.find(x=>x.status==='rejected').reason).toMatchObject({code:'QUOTA_EXCEEDED'});
 await expect(call('second')).resolves.toBeUndefined();
 expect(db.get('qlue-usage',{userId:'first',date:day()}).paidAttempts).toBe(3);
 expect(db.get('qlue-usage',{userId:'second',date:day()}).paidAttempts).toBe(1);
});
test('ten multi-turn interviews count as ten sessions, not as 170 provider calls',async()=>{
 for(let interview=0;interview<10;interview++){
  expect((await quota.reserveQuota('first','interview')).allowed).toBe(true);
  for(let request=0;request<17;request++)await call('first');
 }
 expect((await quota.getUsage('first')).interviews).toEqual({used:10,limit:10,remaining:0});
 expect(db.get('qlue-usage',{userId:'first',date:day()}).paidAttempts).toBe(170);
 expect((await quota.reserveQuota('first','interview')).allowed).toBe(false);
 expect((await quota.reserveQuota('second','interview')).allowed).toBe(true);
 await expect(call('second')).resolves.toBeUndefined();
});
test('user deletion arriving at the budget write cannot recreate usage',async()=>{
 db.beforeSend=c=>{if(c.constructor.name==='TransactWriteCommand')db.seed('qlue-deletion-jobs',{userId:'first'});};
 await expect(call('first')).rejects.toThrow();
 expect(db.get('qlue-usage',{userId:'first',date:day()})).toBeUndefined();
});
test.each(['0','-1','NaN'])('invalid/zero per-user limit %s fails closed without touching the system budget',async value=>{
 process.env.USER_PAID_ATTEMPT_LIMIT=value;
 await expect(call('first')).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
 expect(db.get('qlue-usage',{userId:'BUDGET#GLOBAL',date:day()})).toBeUndefined();
});
test('new UTC days get independent user counters',async()=>{
 const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 db.seed('qlue-usage',{userId:'first',date:yesterday,paidAttempts:500,interview:10});
 await expect(call('first')).resolves.toBeUndefined();
 expect((await quota.reserveQuota('first','interview')).allowed).toBe(true);
 expect(db.get('qlue-usage',{userId:'first',date:yesterday}).paidAttempts).toBe(500);
});
test('verified identity scopes preserve deadlines and do not leak across users',async()=>{
 await deadline.withDeadline(null,async()=>{
  const original=deadline.current();
  await deadline.withIdentity('first',async()=>{
   expect(deadline.current()).toMatchObject({...original,userId:'first'});await paid.beforePaidCall('interview');
  });
  await deadline.withIdentity('second',()=>paid.beforePaidCall('interview'));
  expect(deadline.current()).toBe(original);expect(deadline.current().userId).toBeUndefined();
 });
 expect(db.get('qlue-usage',{userId:'first',date:day()}).paidAttempts).toBe(1);
 expect(db.get('qlue-usage',{userId:'second',date:day()}).paidAttempts).toBe(1);
 expect(()=>deadline.withIdentity('',()=>{})).toThrow('Verified paid-work owner');
});

test('a refused user budget reaches neither Bedrock nor Polly and triggers no engine/provider retries',async()=>{
 const bedrock=mockClient(BedrockRuntimeClient),polly=mockClient(PollyClient);
 db.seed('qlue-usage',{userId:'first',date:day(),paidAttempts:500});
 try {
  await expect(deadline.withDeadline(null,()=>require('../../../src/lib/bedrock').invokeModel('model',{messages:[]}),{userId:'first'})).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
  await expect(deadline.withDeadline(null,()=>require('../../../src/lib/polly').synthesizeSpeech('Question?','Ruth','neural'),{userId:'first'})).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
  expect(bedrock.calls()).toHaveLength(0);expect(polly.calls()).toHaveLength(0);
  expect(db.calls.filter(c=>c.constructor.name==='TransactWriteCommand')).toHaveLength(2);
 }finally{bedrock.restore();polly.restore();}
});
