// Uses synthetic DynamoDB tables. Firebase and email-provider side effects are stubbed.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const backend=path.resolve(__dirname,'../backend');
const load=name=>require(require.resolve(name,{paths:[backend]}));
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,waitUntilTableExists}=load('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,PutCommand,UpdateCommand}=load('@aws-sdk/lib-dynamodb');
const aws=process.argv.includes('--aws-isolated');
const prefix='qlue-otp-test-'+crypto.randomBytes(6).toString('hex'),created=[],checks=[];
Object.assign(process.env,{EMAIL_OTP_TABLE:prefix+'-codes',DELETION_JOBS_TABLE:prefix+'-deletions',
  EMAIL_OTP_DAILY_LIMIT:'40'});
const raw=new DynamoDBClient({region:'us-east-1',maxAttempts:1,...(aws?{}:{endpoint:'http://127.0.0.1:18079',credentials:{accessKeyId:'localTest',secretAccessKey:'localTest'}})});
const db=DynamoDBDocumentClient.from(raw,{marshallOptions:{removeUndefinedValues:true}});
require('../backend/src/lib/dynamodb').docClient=db;
const delivery=require('../backend/src/lib/emailOtpDelivery');
const mails=[],codes=new Map();let deliveryFails=false;
const fakeKey=crypto.randomBytes(32).toString('hex');
Object.assign(delivery,{configured:async()=>({key:fakeKey}),send:async(uid,email)=>{mails.push({uid,email});if(deliveryFails)throw Error('synthetic provider failure');codes.set(uid,String(crypto.randomInt(1000000)).padStart(6,'0'));},confirm:async(uid,code)=>{if(codes.get(uid)!==code)throw Object.assign(Error('incorrect'),{name:'CodeMismatchException'});codes.delete(uid);},remove:async uid=>{codes.delete(uid);}});
const otp=require('../backend/src/lib/emailOtp');
let verified=0;
const person=uid=>({uid,email:uid+'@example.com',verified:false,auth:{updateUser:async(id,update)=>{assert.equal(id,uid);assert.equal(update.email,uid+'@example.com');verified++;}}});
const read=async id=>(await db.send(new GetCommand({TableName:process.env.EMAIL_OTP_TABLE,Key:{id},ConsistentRead:true}))).Item;
const code=()=>codes.get(mails.at(-1).uid);
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const set=async(uid,expr,values)=>db.send(new UpdateCommand({TableName:process.env.EMAIL_OTP_TABLE,Key:{id:'USER#'+uid},UpdateExpression:expr,ExpressionAttributeValues:values}));
async function main(){
  for(const [TableName,key]of [[process.env.EMAIL_OTP_TABLE,'id'],[process.env.DELETION_JOBS_TABLE,'userId']]){
    assert(TableName.startsWith(prefix+'-'));
    await raw.send(new CreateTableCommand({TableName,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:key,AttributeType:'S'}],KeySchema:[{AttributeName:key,KeyType:'HASH'}]}));created.push(TableName);
  }
  if(aws)await Promise.all(created.map(TableName=>waitUntilTableExists({client:raw,maxWaitTime:90,minDelay:2,maxDelay:5},{TableName})));
  const first=await Promise.allSettled(Array.from({length:10},()=>otp.issue(person('parallel'),'ip')));
  if (!first.some(r=>r.status==='fulfilled')) {
    const error=first.find(r=>r.status==='rejected').reason;
    console.error('Challenge failure:',error.name,error.code,error.message);
  }
  assert(first.some(r=>r.status==='fulfilled'));assert.equal(mails.length,1);
  const row=await read('USER#parallel'),valid=code();
  assert.equal(row.status,'SENT');assert.equal(row.code,undefined);assert.equal(row.codeHash,undefined);
  pass('ten concurrent sends produce one email and one code-free challenge');
  const confirmations=await Promise.allSettled(Array.from({length:10},()=>otp.verify(person('parallel'),row.challengeId,valid)));
  assert.equal(confirmations.filter(r=>r.status==='fulfilled').length,1);assert.equal(verified,1);
  assert.equal((await read(`VERIFY#parallel#${Math.floor(Date.now()/3600000)}`)).userId,'parallel');
  assert.equal((await read('USER#parallel')).status,'CONSUMED');assert.equal((await read('USER#parallel')).codeHash,undefined);
  pass('ten correct concurrent submissions consume the code once');
  await assert.rejects(otp.verify(person('parallel'),row.challengeId,valid),{code:'OTP_INVALID_OR_EXPIRED'});
  await assert.rejects(otp.verify(person('different'),row.challengeId,valid),{code:'OTP_INVALID_OR_EXPIRED'});
  pass('replay and cross-account challenges fail');
  const wrong=await otp.issue(person('wrong'),'ip');const right=code(),guess=right==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)await assert.rejects(otp.verify(person('wrong'),wrong.challengeId,guess),{code:'OTP_INVALID_OR_EXPIRED'});
  await assert.rejects(otp.verify(person('wrong'),wrong.challengeId,right),{statusCode:429});
  assert.equal((await read('USER#wrong')).attempts,5);pass('five wrong guesses exhaust a challenge, including its correct code');
  const expired=await otp.issue(person('expired'),'ip'),expiredCode=code();
  await set('expired','SET expiresAt = :old',{':old':Math.floor(Date.now()/1000)-1});
  await assert.rejects(otp.verify(person('expired'),expired.challengeId,expiredCode),{code:'OTP_INVALID_OR_EXPIRED'});
  pass('expired codes fail even while DynamoDB retains the row');
  const old=await otp.issue(person('rotate'),'ip'),oldCode=code();
  await set('rotate','SET resendAt = :zero',{':zero':0});
  const newer=await otp.issue(person('rotate'),'ip'),newCode=code();assert.notEqual(old.challengeId,newer.challengeId);
  await assert.rejects(otp.verify(person('rotate'),old.challengeId,oldCode),{code:'OTP_INVALID_OR_EXPIRED'});
  await otp.verify(person('rotate'),newer.challengeId,newCode);pass('resending invalidates the old challenge');
  const capped=await otp.issue(person('capped'),'ip'),cappedCode=code();
  await db.send(new PutCommand({TableName:process.env.EMAIL_OTP_TABLE,Item:{id:`VERIFY#capped#${Math.floor(Date.now()/3600000)}`,count:20,ttl:Math.floor(Date.now()/1000)+7200}}));
  await assert.rejects(otp.verify(person('capped'),capped.challengeId,cappedCode),{statusCode:429});
  assert.equal((await read('USER#capped')).attempts,0);pass('hourly verification cap is atomic with challenge attempt reservation');
  deliveryFails=true;
  await assert.rejects(otp.issue(person('delivery'),'ip'),{code:'OTP_DELIVERY_FAILED'});
  const failed=await read('USER#delivery');assert.equal(failed.status,'DELIVERY_FAILED');assert.equal(failed.codeHash,undefined);
  pass('failed email delivery invalidates its code');deliveryFails=false;
  await db.send(new PutCommand({TableName:process.env.DELETION_JOBS_TABLE,Item:{userId:'deleting',status:'PENDING'}}));
  const before=mails.length;
  await assert.rejects(otp.issue(person('deleting'),'ip'));assert.equal(mails.length,before);
  assert.equal(await read('USER#deleting'),undefined);pass('account deletion fence prevents new challenge/email');
  await db.send(new PutCommand({TableName:process.env.EMAIL_OTP_TABLE,Item:{id:`SEND#DAY#${Math.floor((Date.now()/1000-9*3600)/86400)}`,count:40,ttl:Math.floor(Date.now()/1000)+172800}}));
  await assert.rejects(otp.issue(person('over-budget'),'ip'),{statusCode:429});assert.equal(mails.length,before);
  assert.equal(await read('USER#over-budget'),undefined);pass('global daily email cap prevents delivery and state creation');
  console.log(JSON.stringify({database:aws?'AWS isolated DynamoDB':'DynamoDB Local',checks,realEmailSent:false,realFirebaseUsersChanged:false}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(aws)for(const TableName of created){
    try{assert(TableName.startsWith(prefix+'-'));await raw.send(new DeleteTableCommand({TableName}));}
    catch(error){console.error('Synthetic cleanup failed',TableName,error.name);process.exitCode=1;}
  }
  raw.destroy();
});
