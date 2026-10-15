const {DocumentBoundary}=require('../../helpers/documentBoundary');
const ddb=require('../../../src/lib/dynamodb');
const quota=require('../../../src/lib/quota');
let db;const date=()=>new Date().toISOString().slice(0,10);
beforeEach(()=>{db=new DocumentBoundary();jest.spyOn(ddb.docClient,'send').mockImplementation(c=>db.send(c));});
afterEach(()=>jest.restoreAllMocks());
test('missing account fails closed, unknown tier resolves to free, and premium is allowed by policy',()=>{expect(()=>quota.getUserTier(undefined)).toThrow(/deleted/i);expect(quota.getUserTier({})).toBe('free');expect(quota.getUserTier({tier:'enterprise'})).toBe('free');expect(quota.getUserTier({tier:'free'})).toBe('free');expect(quota.getLimit('free','interview')).toBe(10);expect(quota.isPremiumVoiceAllowed('free')).toBe(true);});
test('reservation returns actual accounting and uses an atomic deletion fence plus conditional counter',async()=>{
 db.seed('qlue-usage',{userId:'u',date:date(),interview:2});expect(await quota.reserveQuota('u','interview')).toEqual({allowed:true,used:3,limit:10,remaining:7});
 const txn=db.calls.find(c=>c.constructor.name==='TransactWriteCommand').input.TransactItems;expect(txn[0].ConditionCheck.TableName).toBe('qlue-deletion-jobs');expect(txn[1].Update.ConditionExpression).toBe('attribute_not_exists(#a) OR #a < :limit');
});
test('cap denial does not increment and concurrent reservations have one final winner',async()=>{
 db.seed('qlue-usage',{userId:'u',date:date(),interview:9});const results=await Promise.all([quota.reserveQuota('u','interview'),quota.reserveQuota('u','interview')]);expect(results.filter(x=>x.allowed)).toHaveLength(1);expect(results.find(x=>!x.allowed)).toEqual({allowed:false,used:10,limit:10,remaining:0});
});
test('unknown action remains counted without a cap',async()=>{expect(quota.getLimit('free','other')).toBeNull();db.seed('qlue-usage',{userId:'u',date:date(),other:41});expect(await quota.reserveQuota('u','other')).toEqual({allowed:true,used:42,limit:null,remaining:null});});
test('external throughput errors propagate',async()=>{db.beforeSend=c=>{if(c.constructor.name==='TransactWriteCommand')throw Object.assign(new Error('Unavailable'),{name:'ProvisionedThroughputExceededException'});};await expect(quota.reserveQuota('u','interview')).rejects.toMatchObject({name:'ProvisionedThroughputExceededException'});});
test('deletion arriving between read and write cannot recreate usage',async()=>{db.beforeSend=c=>{if(c.constructor.name==='TransactWriteCommand')db.seed('qlue-deletion-jobs',{userId:'u'});};expect((await quota.reserveQuota('u','interview')).allowed).toBe(false);expect(db.get('qlue-usage',{userId:'u',date:date()})).toBeUndefined();});
test('refund decrements once, never below zero, and never recreates deleted account usage',async()=>{db.seed('qlue-usage',{userId:'u',date:date(),interview:1});await quota.refundQuota('u','interview');await quota.refundQuota('u','interview');expect(db.get('qlue-usage',{userId:'u',date:date()}).interview).toBe(0);db.seed('qlue-deletion-jobs',{userId:'u'});await quota.refundQuota('u','interview');expect(db.get('qlue-usage',{userId:'u',date:date()}).interview).toBe(0);});
test('failed refunds do not mask the original caller failure',async()=>{db.beforeSend=()=>{throw new Error('Unavailable');};await expect(quota.refundQuota('u','interview')).resolves.toBeUndefined();});
test('missing usage is zero and stored usage renders remaining counts',async()=>{expect((await quota.getUsage('u')).interviews.used).toBe(0);db.seed('qlue-usage',{userId:'u',date:date(),interview:3});expect(await quota.getUsage('u')).toMatchObject({interviews:{used:3,limit:10,remaining:7}});});
test('display read failure returns the documented empty display',async()=>{db.beforeSend=()=>{throw new Error('Unavailable');};expect((await quota.getUsage('u')).interviews.used).toBe(0);});
