// Only uniquely named accounts/rows/objects created by this run are mutated.
// Passwords, Firebase tokens and credentials stay in memory and are never logged.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const req=require('node:module').createRequire(path.resolve(__dirname,'../backend/package.json'));
const {DynamoDBClient}=req('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand,DeleteCommand}=req('@aws-sdk/lib-dynamodb');
const {S3Client,PutObjectCommand,ListObjectVersionsCommand,DeleteObjectsCommand}=req('@aws-sdk/client-s3');
const {LambdaClient,InvokeCommand}=req('@aws-sdk/client-lambda');
const {CognitoIdentityProviderClient,AdminCreateUserCommand,AdminGetUserCommand,AdminDeleteUserCommand}=req('@aws-sdk/client-cognito-identity-provider');
const {NodeHttpHandler}=req('@smithy/node-http-handler');
const config={region:'us-east-1',maxAttempts:2,requestHandler:new NodeHttpHandler({connectionTimeout:5000,requestTimeout:20000})};
const db=DynamoDBDocumentClient.from(new DynamoDBClient(config)),s3=new S3Client(config),lambda=new LambdaClient(config),cognito=new CognitoIdentityProviderClient(config);
const dir=path.resolve(__dirname,'../tmp/account-deletion');
const resources=JSON.parse(fs.readFileSync(path.join(dir,'resources.json'),'utf8'));
const physical=id=>{const r=resources.find(r=>r.LogicalResourceId===id);if(!r)throw Error('Missing '+id);return r.PhysicalResourceId;};
const label='qlue-delete-smoke-'+crypto.randomBytes(10).toString('hex');
const password='Aa1!'+crypto.randomBytes(24).toString('base64url');
const identities=[],rows=[],objects=[],checks=[];
let auth,stage='configuration';
const safeUid=uid=>assert(identities.some(i=>i.uid===uid)&&uid.startsWith(label),'Only this run owns the target');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const get=async(id,key)=>(await db.send(new GetCommand({TableName:physical(id),Key:key,ConsistentRead:true}))).Item;
const put=async(id,item,key)=>{rows.push({id,key});await db.send(new PutCommand({TableName:physical(id),Item:item,ConditionExpression:'attribute_not_exists(#pk)',ExpressionAttributeNames:{'#pk':Object.keys(key)[0]}}));};
async function create(suffix,verified=true,email=`${label}-${suffix}@example.com`){
  const uid=`${label}-${suffix}`;identities.push({uid,email});
  await auth.createUser({uid,email,password,emailVerified:verified,displayName:'Synthetic deletion check'});
  return uid;
}
async function signIn(email){
  const key=await require('../backend/src/lib/secrets').getFirebaseApiKey();
  const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();return {status:response.status,token:data.idToken};
}
async function api(token,body={confirmation:'DELETE'},method='DELETE',route='/auth/account'){
  const response=await fetch('https://79440l9vo3.execute-api.us-east-1.amazonaws.com/prod'+route,{method,
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(method==='GET'?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  let data={};try{data=await response.json();}catch{}
  return {status:response.status,data};
}
async function absent(uid){try{await auth.getUser(uid);return false;}catch(e){if(e.code==='auth/user-not-found')return true;throw e;}}
async function until(predicate,label,ms=45000){const end=Date.now()+ms;do{if(await predicate())return;await pause(1500);}while(Date.now()<end);throw Error('Timed out: '+label);}
async function invoke(id,event){
  const result=await lambda.send(new InvokeCommand({FunctionName:physical(id),InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(event))}));
  assert(!result.FunctionError,`${id} failed`);return JSON.parse(Buffer.from(result.Payload).toString());
}
async function seed(uid){
  const stamp=Date.now(),sid=label+'-session';
  const fixtures=[
    ['UsersTable',{userId:uid,email:identities[0].email},{userId:uid}],
    ['AnalysisJobsTable',{jobId:label+'-job',userId:uid,status:'COMPLETE'},{jobId:label+'-job'}],
    ['SessionsTable',{sessionId:sid,userId:uid,startedAt:stamp,currentState:'TERMINATED',feedbackStatus:'COMPLETE'},{sessionId:sid}],
    ['SessionsTable',{sessionId:'LOCK#'+uid},{sessionId:'LOCK#'+uid}],
    ['TranscriptsTable',{transcriptId:label+'-transcript',sessionId:sid,userId:uid,turnIndex:1},{transcriptId:label+'-transcript'}],
    ['TranscriptsTable',{transcriptId:label+'-receipt',userId:uid},{transcriptId:label+'-receipt'}],
    ['ConceptStatesTable',{conceptId:label+'-concept',sessionId:sid,concept:'synthetic'},{conceptId:label+'-concept'}],
    ['ResumesTable',{resumeId:label+'-resume',userId:uid,uploadedAt:stamp,status:'PARSED'},{resumeId:label+'-resume'}],
    ['NotificationsTable',{notificationId:label+'-notification',userId:uid,sentAt:stamp},{notificationId:label+'-notification'}],
    ['UsageTable',{userId:uid,date:'2026-10-18'},{userId:uid,date:'2026-10-18'}],
    ['SupportTable',{ticketId:label+'-ticket',userId:uid},{ticketId:label+'-ticket'}],
    ['WSConnectionsTable',{connectionId:label+'-socket',userId:uid,isActive:'true'},{connectionId:label+'-socket'}],
    ['EmailOtpTable',{id:'USER#'+uid,userId:uid},{id:'USER#'+uid}],
    ['EmailOtpTable',{id:'VERIFY#'+uid+'#synthetic',userId:uid},{id:'VERIFY#'+uid+'#synthetic'}]
  ];
  for(const f of fixtures)await put(...f);
  // MODIFY adds ownership after INSERT so this synthetic row never invokes paid synthesis.
  const fid=label+'-feedback';await put('FeedbackTable',{feedbackId:fid,sessionId:sid,generatedAt:stamp,notificationStatus:'DELIVERED'},{feedbackId:fid});
  await db.send(new UpdateCommand({TableName:physical('FeedbackTable'),Key:{feedbackId:fid},UpdateExpression:'SET userId = :uid',ExpressionAttributeValues:{':uid':uid}}));
  const username='qlue_'+crypto.createHash('sha256').update(uid).digest('hex');
  await cognito.send(new AdminCreateUserCommand({UserPoolId:physical('EmailOtpPool'),Username:username,MessageAction:'SUPPRESS',TemporaryPassword:password,UserAttributes:[{Name:'email',Value:identities[0].email}]}));
  for(const [id,key]of [['ResumesBucket',`resumes/${uid}/synthetic.pdf`],['ScrapedContentBucket',`jd/${uid}/synthetic.pdf`],['AudioBucket',`audio/${sid}/synthetic.mp3`],['AnswerAudioBucket',`answers/${sid}/synthetic.wav`]]){
    objects.push({bucket:physical(id),key});
    for(let version=0;version<2;version++)await s3.send(new PutObjectCommand({Bucket:physical(id),Key:key,Body:Buffer.from('synthetic deletion fixture '+version)}));
  }
  await pause(3000); // Allow owned GSI entries to become visible before requesting deletion.
}
async function expediteAndFinish(uid){
  safeUid(uid);
  await until(async()=>{const j=await get('DeletionJobsTable',{userId:uid});return j&&!j.recoveryExpiresAt;},'release deletion lease');
  await db.send(new UpdateCommand({TableName:physical('DeletionJobsTable'),Key:{userId:uid},UpdateExpression:'SET drainUntil = :now',
    ConditionExpression:'attribute_exists(userId)',ExpressionAttributeValues:{':now':Date.now()-1}}));
  await invoke('DeletionWorkerFunction',{userId:uid});
  const job=await get('DeletionJobsTable',{userId:uid});assert.equal(job.status,'COMPLETE');
  assert.equal(await absent(uid),true);return job;
}
async function versions(obj){
  const page=await s3.send(new ListObjectVersionsCommand({Bucket:obj.bucket,Prefix:obj.key}));
  return [...page.Versions||[],...page.DeleteMarkers||[]].filter(v=>v.Key===obj.key);
}
async function main(){
  auth=await require('../backend/src/lib/firebase').getAuth();
  assert.equal((await api()).status,401);checks.push('Missing identity is rejected by live endpoint');
  stage='create scoped identities';const owner=await create('owner'),decoy=await create('decoy');
  stage='seed scoped fixtures';await seed(owner);
  stage='fresh owner proof';const token=(await signIn(identities[0].email)).token;assert(token);
  assert.equal((await api(token,{})).status,400);assert.equal(await absent(owner),false);
  checks.push('Missing typed confirmation cannot delete an account');
  stage='delete request';const accepted=await api(token,{confirmation:'DELETE',userId:decoy});
  assert.equal(accepted.status,202);assert.equal(accepted.data.deletionAccepted,true);assert.equal(accepted.data.identityDeleted,true);
  assert.equal(await absent(owner),true);assert.equal(await absent(decoy),false);
  checks.push('Only signed owner is deleted from Firebase; caller-supplied other UID is ignored');
  stage='reject old login';assert.notEqual((await signIn(identities[0].email)).status,200);
  const denied=await api(token,undefined,'GET','/auth/profile');assert([401,403].includes(denied.status));
  checks.push('Deleted account password and old API token cannot sign in or read profile');
  stage='storage drain';assert(await get('UsersTable',{userId:owner}));
  assert((await versions(objects[0])).length>=1);checks.push('Storage remains during upload-expiry drain');
  stage='same-email new identity';const replacement=await create('replacement',true,identities[0].email);
  await put('UsersTable',{userId:replacement,email:identities[0].email},{userId:replacement});
  assert.equal((await signIn(identities[0].email)).status,200);checks.push('Same email can register again with a fresh Firebase UID');
  await until(async()=>(await get('DeletionJobsTable',{userId:owner}))?.checkpoints?.accessRevoked,'automatic access revocation');
  assert.equal((await get('WSConnectionsTable',{connectionId:label+'-socket'})).isActive,'false');
  checks.push('Stream/queue worker automatically revokes active socket rows');
  stage='complete scoped cleanup';const job=await expediteAndFinish(owner);
  for(const row of rows.filter(r=>r.key.userId!==replacement))assert.equal(await get(row.id,row.key),undefined,'Owned fixture remains in '+row.id);
  for(const obj of objects)assert.equal((await versions(obj)).length,0,'Owned S3 version remains');
  try{await cognito.send(new AdminGetUserCommand({UserPoolId:physical('EmailOtpPool'),Username:'qlue_'+crypto.createHash('sha256').update(owner).digest('hex')}));throw Error('Auxiliary identity remains');}
  catch(e){if(e.name!=='UserNotFoundException')throw e;}
  assert.equal(job.checkpoints.resumes,true);checks.push('Complete purge verified across 12 owned data categories, auxiliary OTP identity and all tested S3 versions');
  stage='late feedback';await invoke('UpdateGlobalProfileFunction',{Records:[{eventName:'INSERT',dynamodb:{NewImage:{userId:{S:owner}}}}]});
  assert.equal(await get('UsersTable',{userId:owner}),undefined);
  assert(await get('UsersTable',{userId:replacement}));assert.equal(await absent(replacement),false);assert.equal(await absent(decoy),false);
  checks.push('Late feedback cannot recreate old profile; fresh same-email and unrelated test accounts survive');
  stage='idempotent retry';const retry=await api(token);assert.equal(retry.status,200);assert.equal(retry.data.status,'COMPLETE');
  checks.push('Lost-response retry remains authenticated and idempotent after Firebase removal');
  stage='unverified account';const unverified=await create('unverified',false);
  const unverifiedToken=(await signIn(identities.find(i=>i.uid===unverified).email)).token;
  assert.equal((await api(unverifiedToken)).data.identityDeleted,true);await expediteAndFinish(unverified);
  checks.push('Unverified account can delete itself from the verification screen flow');
  stage='client interrupted before identity removal';const interrupted=await create('interrupted');safeUid(interrupted);
  await put('DeletionJobsTable',{userId:interrupted,status:'PENDING',requestedAt:Date.now(),drainUntil:Date.now()+1200000,checkpoints:{}},{userId:interrupted});
  await until(()=>absent(interrupted),'stream-backed removal after client interruption');
  await expediteAndFinish(interrupted);checks.push('Persisted job removes Firebase automatically even if client stops before identity removal');
}
async function cleanup(){
  const errors=[];
  for(const row of rows){try{await db.send(new DeleteCommand({TableName:physical(row.id),Key:row.key}));}catch{errors.push('fixture-row');}}
  for(const obj of objects){try{const all=await versions(obj);if(all.length)await s3.send(new DeleteObjectsCommand({Bucket:obj.bucket,Delete:{Objects:all.map(v=>({Key:v.Key,VersionId:v.VersionId}))}}));}catch{errors.push('fixture-object');}}
  for(const i of identities){safeUid(i.uid);
    try{await auth.deleteUser(i.uid);}catch(e){if(e.code!=='auth/user-not-found')errors.push('fixture-identity');}
    try{await cognito.send(new AdminDeleteUserCommand({UserPoolId:physical('EmailOtpPool'),Username:'qlue_'+crypto.createHash('sha256').update(i.uid).digest('hex')}));}catch(e){if(e.name!=='UserNotFoundException')errors.push('fixture-otp');}
    try{await db.send(new DeleteCommand({TableName:physical('DeletionJobsTable'),Key:{userId:i.uid}}));}catch{errors.push('fixture-job');}
  }
  assert.equal(errors.length,0,'Synthetic cleanup failed');checks.push('All identities and fixtures created by this run cleaned up');
}
(async()=>{
  let error;
  try{await main();}catch(e){error=e;console.error(JSON.stringify({stage,error:e.name,message:e.message}));}
  try{if(auth)await cleanup();}catch(e){error=error||e;console.error(JSON.stringify({stage:'synthetic cleanup',error:e.name,message:e.message}));}
  const result={testedAt:new Date().toISOString(),passed:!error,scope:'uniquely named synthetic accounts only',checks,syntheticDrainExpedited:true,realCustomerAccountsChanged:0};
  fs.writeFileSync(path.join(dir,'live-smoke.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  db.destroy();s3.destroy();lambda.destroy();cognito.destroy();if(error)process.exitCode=1;
})().catch(e=>{console.error(e.name);process.exitCode=1;});
