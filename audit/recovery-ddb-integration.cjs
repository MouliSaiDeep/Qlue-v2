// Real DynamoDB Local transactions; external paid/destructive providers are stubbed.
// Defaults to loopback. --aws-isolated creates and removes only new synthetic tables.
const assert=require('node:assert/strict'),path=require('node:path');
const backend=path.resolve(__dirname,'../backend');
const load=name=>require(require.resolve(name,{paths:[backend]}));
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,waitUntilTableExists}=load('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,PutCommand,GetCommand,UpdateCommand}=load('@aws-sdk/lib-dynamodb');
const {mockClient}=load('aws-sdk-client-mock');
const {SQSClient,SendMessageCommand}=load('@aws-sdk/client-sqs');
const {LambdaClient,InvokeCommand}=load('@aws-sdk/client-lambda');
const {SNSClient,PublishCommand}=load('@aws-sdk/client-sns');
const awsIsolated=process.argv.includes('--aws-isolated');
const endpoint=process.env.RECOVERY_TEST_DDB_ENDPOINT||'http://127.0.0.1:18079';
if(!awsIsolated&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))throw Error('Only isolated loopback DynamoDB is allowed');
const raw=new DynamoDBClient({region:'us-east-1',maxAttempts:1,...(awsIsolated?{}:{endpoint,credentials:{accessKeyId:'localTest',secretAccessKey:'localTest'}})});
const doc=DynamoDBDocumentClient.from(raw,{marshallOptions:{removeUndefinedValues:true}});
const prefix='qlue-cost-test-'+require('node:crypto').randomBytes(6).toString('hex');
const created=[];
const tables={ANALYSIS_JOBS_TABLE:['analysis','jobId'],DELETION_JOBS_TABLE:['deletions','userId'],
  SESSIONS_TABLE:['sessions','sessionId'],RESUMES_TABLE:['resumes','resumeId'],FEEDBACK_TABLE:['feedback','feedbackId'],USERS_TABLE:['users','userId'],USAGE_TABLE:['usage','userId','date']};
for(const [name,[suffix]]of Object.entries(tables))process.env[name]=prefix+'-'+suffix;
Object.assign(process.env,{RECOVERY_QUEUE_URL:'isolated-recovery',FEEDBACK_RECOVERY_QUEUE_URL:'isolated-feedback',
  TURN_RECOVERY_QUEUE_URL:'isolated-turn',ASYNC_QUEUE_URL:'isolated-primary',RESUME_WORKER_LAMBDA:'isolated-resume',
  FEEDBACK_TOPIC_ARN:'arn:aws:sns:us-east-1:000000000000:isolated-feedback'});
function stub(relative,exports){const file=require.resolve(path.join(backend,'src',relative));require.cache[file]={id:file,filename:file,loaded:true,exports};}
let analyses=0,purges=0,notifications=0,notificationFails=false,purgeFails=false;
stub('handlers/jd/analyzeJobMatch.js',{handler:async()=>{analyses++;await new Promise(r=>setTimeout(r,20));return {statusCode:200,body:'{"matchScore":80}'};}});
stub('lib/accountDeletion.js',{deleteAllUserData:async(uid,options)=>{
  purges++;await options.onCheckpoint('syntheticFiles',true);return {failures:purgeFails?['synthetic: transient']:[]};
}});
stub('lib/firebase.js',{deleteUser:async()=>true});
stub('handlers/feedback/sendFeedbackNotification.js',{handler:async()=>{notifications++;if(notificationFails)throw Error('controlled delivery failure');return {success:true};}});
const sqs=mockClient(SQSClient),lambda=mockClient(LambdaClient),sns=mockClient(SNSClient);
sqs.on(SendMessageCommand).resolves({MessageId:'synthetic'});
lambda.on(InvokeCommand).resolves({StatusCode:202});sns.on(PublishCommand).resolves({MessageId:'synthetic'});
const ddb=require('../backend/src/lib/dynamodb');ddb.docClient=doc;
const work=require('../backend/src/lib/eventWork');
const analysis=require('../backend/src/handlers/jd/analysisWorker').handler;
const deletion=require('../backend/src/handlers/auth/deletionWorker').handler;
const dispatch=require('../backend/src/handlers/feedback/dispatchFeedbackJobs').handler;
const feedback=require('../backend/src/handlers/feedback/recoverFeedback').handler;
const resume=require('../backend/src/handlers/resume/recoverResumes').handler;
const turns=require('../backend/src/handlers/interview/recoverTurns').handler;
const checks=[];
const put=(env,item)=>doc.send(new PutCommand({TableName:process.env[env],Item:item}));
const get=async(env,key)=>(await doc.send(new GetCommand({TableName:process.env[env],Key:key,ConsistentRead:true}))).Item;
const queue=(handler,task)=>handler({Records:[{eventSource:'aws:sqs',messageId:'synthetic-message',
  body:JSON.stringify({version:1,dueAt:Date.now()-1,...task})}]});
const pass=name=>{checks.push(name);console.log('PASS '+name);};
async function main(){
  for(const [env,[,key,range]]of Object.entries(tables)){
    const name=process.env[env];
    if(!name.startsWith(prefix+'-'))throw Error('Refusing non-synthetic table');
    await raw.send(new CreateTableCommand({TableName:name,
      BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:key,AttributeType:'S'},...(range?[{AttributeName:range,AttributeType:'S'}]:[])],
      KeySchema:[{AttributeName:key,KeyType:'HASH'},...(range?[{AttributeName:range,KeyType:'RANGE'}]:[])]}));
    created.push(name);
  }
  if(awsIsolated)await Promise.all(created.map(TableName=>waitUntilTableExists({client:raw,maxWaitTime:90,minDelay:2,maxDelay:5},{TableName})));
  await put('ANALYSIS_JOBS_TABLE',{jobId:'j',userId:'u',kind:'jd',body:'{}',status:'PENDING',createdAt:Date.now()});
  const concurrent=await Promise.all([queue(analysis,{jobId:'j'}),queue(analysis,{jobId:'j'})]);
  for(const result of concurrent)if(result.batchItemFailures.length)assert.deepEqual(await queue(analysis,{jobId:'j'}),{batchItemFailures:[]});
  assert.equal(analyses,1);assert.equal((await get('ANALYSIS_JOBS_TABLE',{jobId:'j'})).status,'COMPLETE');
  pass('analysis concurrent claims perform one business operation');
  await put('ANALYSIS_JOBS_TABLE',{jobId:'expired',userId:'u',kind:'jd',body:'{}',status:'RUNNING',leaseExpiresAt:Date.now()-1,attemptCount:3,createdAt:Date.now()-60000});
  assert.deepEqual(await queue(analysis,{jobId:'expired'}),{batchItemFailures:[]});
  assert.equal((await get('ANALYSIS_JOBS_TABLE',{jobId:'expired'})).status,'FAILED');assert.equal(analyses,1);
  pass('analysis attempt cap produces terminal failure');
  delete require.cache[require.resolve('../backend/src/handlers/jd/analyzeJobMatch')];
  for(const kind of ['jd','website']) {
    const jobId='invalid-'+kind;
    await put('ANALYSIS_JOBS_TABLE',{jobId,userId:'u',kind,body:'{}',status:'PENDING',createdAt:Date.now()});
    assert.deepEqual(await queue(analysis,{jobId}),{batchItemFailures:[]});
    const invalid=await get('ANALYSIS_JOBS_TABLE',{jobId});
    assert.equal(invalid.status,'FAILED');assert.equal(invalid.result.statusCode,400);
  }
  pass('restored JD and website handler exports are callable by durable analysis jobs');

  await put('DELETION_JOBS_TABLE',{userId:'deleted-user',status:'PENDING',drainUntil:Date.now()-1,checkpoints:{}});
  await put('USERS_TABLE',{userId:'deleted-user'});
  const deletionResults=await Promise.all([queue(deletion,{userId:'deleted-user'}),queue(deletion,{userId:'deleted-user'})]);
  for(const result of deletionResults)if(result.batchItemFailures.length)await queue(deletion,{userId:'deleted-user'});
  const tombstone=await get('DELETION_JOBS_TABLE',{userId:'deleted-user'});
  assert.equal(tombstone.status,'COMPLETE');assert.equal(tombstone.checkpoints.syntheticFiles,true);assert.equal(purges,1);
  assert.equal(await get('USERS_TABLE',{userId:'deleted-user'}),undefined);
  pass('deletion transaction, owner lease, checkpoint, and completion');
  await put('DELETION_JOBS_TABLE',{userId:'retry-user',status:'PENDING',drainUntil:0,checkpoints:{}});
  purgeFails=true;
  assert.equal((await queue(deletion,{userId:'retry-user'})).batchItemFailures.length,1);
  assert.equal((await get('DELETION_JOBS_TABLE',{userId:'retry-user'})).status,'RETRYING');
  purgeFails=false;await queue(deletion,{userId:'retry-user'});
  assert.equal((await get('DELETION_JOBS_TABLE',{userId:'retry-user'})).status,'COMPLETE');
  pass('deletion failure retains and resumes durable work');

  const pending={sessionId:'outbox',userId:'u',moduleType:'INTRO',version:1,currentState:'GENERATING_FEEDBACK',
    feedbackAttemptId:'attempt',feedbackStatus:'PENDING',feedbackJob:{status:'PENDING',attempts:0},
    feedbackDispatchPending:'PENDING',feedbackJobUpdatedAt:Date.now()-70000};
  await put('SESSIONS_TABLE',pending);
  sns.on(PublishCommand).rejects(Error('controlled SNS failure'));
  assert.deepEqual(await queue(dispatch,{sessionId:'outbox',attemptId:'attempt'}),{batchItemFailures:[]});
  const retained=await get('SESSIONS_TABLE',{sessionId:'outbox'});
  assert.equal(retained.feedbackJob.attempts,1);assert.equal(retained.feedbackJob.status,'PENDING');
  await doc.send(new UpdateCommand({TableName:process.env.SESSIONS_TABLE,Key:{sessionId:'outbox'},UpdateExpression:'SET feedbackJobUpdatedAt = :time',ExpressionAttributeValues:{':time':Date.now()-70000}}));
  sns.on(PublishCommand).resolves({MessageId:'accepted'});
  assert.deepEqual(await queue(dispatch,{sessionId:'outbox',attemptId:'attempt'}),{batchItemFailures:[]});
  assert.equal((await get('SESSIONS_TABLE',{sessionId:'outbox'})).currentState,'TERMINATED');
  pass('feedback outbox real conditional retry and finalization');

  await put('SESSIONS_TABLE',{sessionId:'s',userId:'u',feedbackAttemptId:'a',feedbackStatus:'PENDING',feedbackAttemptStartedAt:Date.now()-13*60000});
  await put('FEEDBACK_TABLE',{feedbackId:'f',sessionId:'s',userId:'u',attemptId:'a',notificationStatus:'PENDING',notificationAttempts:0});
  notificationFails=true;await queue(feedback,{kind:'notification',feedbackId:'f'});
  assert.equal((await get('FEEDBACK_TABLE',{feedbackId:'f'})).notificationStatus,'PENDING');
  notificationFails=false;assert.deepEqual(await queue(feedback,{kind:'notification',feedbackId:'f'}),{batchItemFailures:[]});
  const sent=await get('FEEDBACK_TABLE',{feedbackId:'f'});
  assert.equal(sent.notificationStatus,'DELIVERED');assert.equal(sent.notificationAttempts,2);
  await queue(feedback,{kind:'notification',feedbackId:'f'});assert.equal(notifications,2);
  pass('notification fenced delivery, retry count, and terminal no-op');
  await queue(feedback,{kind:'feedbackTimeout',sessionId:'s',attemptId:'old'});
  assert.equal((await get('SESSIONS_TABLE',{sessionId:'s'})).feedbackStatus,'PENDING');
  await queue(feedback,{kind:'feedbackTimeout',sessionId:'s',attemptId:'a'});
  assert.equal((await get('SESSIONS_TABLE',{sessionId:'s'})).feedbackStatus,'FAILED');
  pass('feedback timeout respects attempt identity');

  await put('RESUMES_TABLE',{resumeId:'r',userId:'u',status:'PARSING',s3Key:'synthetic.pdf',updatedAt:new Date(Date.now()-4*60000).toISOString()});
  assert.deepEqual(await queue(resume,{resumeId:'r'}),{batchItemFailures:[]});
  assert.equal((await get('RESUMES_TABLE',{resumeId:'r'})).parseRecoveryAttempts,1);
  assert.equal(lambda.commandCalls(InvokeCommand).length,1);
  await doc.send(new UpdateCommand({TableName:process.env.RESUMES_TABLE,Key:{resumeId:'r'},UpdateExpression:'SET claimedAt = :old, parseRecoveryAttempts = :attempts',ExpressionAttributeValues:{':old':Date.now()-4*60000,':attempts':3}}));
  assert.deepEqual(await queue(resume,{resumeId:'r'}),{batchItemFailures:[]});
  assert.equal((await get('RESUMES_TABLE',{resumeId:'r'})).status,'FAILED');
  pass('legacy resume claims and exhausted recovery use valid transactions');

  const job={sessionId:'turn',userId:'u',action:'turn_submit',jobId:'turn-job',body:{textTranscript:'synthetic answer'}};
  await put('SESSIONS_TABLE',{sessionId:'turn',userId:'u',version:1,currentState:'PROCESSING_RESPONSE',jobId:'turn-job',pendingJob:job,updatedAt:new Date().toISOString()});
  const before=sqs.commandCalls(SendMessageCommand).length;
  await queue(turns,{sessionId:'turn',jobId:'turn-job'});
  const calls=sqs.commandCalls(SendMessageCommand).slice(before).map(c=>c.args[0].input);
  assert.equal(calls[0].QueueUrl,'isolated-primary');assert.deepEqual(JSON.parse(calls[0].MessageBody),job);
  await doc.send(new UpdateCommand({TableName:process.env.SESSIONS_TABLE,Key:{sessionId:'turn'},UpdateExpression:'SET jobAttemptCount = :attempts',ExpressionAttributeValues:{':attempts':3}}));
  await queue(turns,{sessionId:'turn',jobId:'turn-job'});
  assert.equal((await get('SESSIONS_TABLE',{sessionId:'turn'})).currentState,'ERROR');
  pass('turn republication and exhausted-version fence');
  process.env.PAID_ATTEMPT_LIMIT='3';process.env.QLUE_PAID_OPS_DISABLED='';delete process.env.PAID_OPS_SWITCH_PARAMETER;
  const paidWork=require('../backend/src/lib/paidWork');paidWork.resetCache();
  const attempts=await Promise.allSettled(Array.from({length:10},()=>paidWork.beforePaidCall('resumeParse')));
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,3);
  const budgetKey={userId:'BUDGET#GLOBAL',date:new Date().toISOString().slice(0,10)};
  assert.equal((await doc.send(new GetCommand({TableName:process.env.USAGE_TABLE,Key:budgetKey,ConsistentRead:true}))).Item.paidAttempts,3);
  process.env.QLUE_PAID_OPS_DISABLED='all';
  await assert.rejects(paidWork.beforePaidCall('resumeParse'),{code:'SERVICE_PAUSED'});
  process.env.QLUE_PAID_OPS_DISABLED='';process.env.PAID_ATTEMPT_LIMIT='0';
  await assert.rejects(paidWork.beforePaidCall('resumeParse'),/budget is exhausted/);
  pass('real atomic provider budget holds under concurrency and honors pause/zero limits');
  await put('RESUMES_TABLE',{resumeId:'repeat-request',userId:'u',status:'UPLOADING',s3Key:'synthetic.pdf'});
  process.env.AWS_LAMBDA_FUNCTION_NAME='isolated-resume';
  stub('lib/s3.js',{headObject:async()=>({versionId:'version-1',contentLength:1000})});
  const resumeApi=require('../backend/src/handlers/resume/processResumeUpload').handler;
  const request={requestContext:{authorizer:{uid:'u'}},body:JSON.stringify({resumeId:'repeat-request'})};
  const beforeRepeatedAdmission=lambda.commandCalls(InvokeCommand).length;
  const responses=await Promise.all(Array.from({length:10},()=>resumeApi(request)));
  for(const response of responses)assert.equal(response.statusCode,202);
  const repeatedResumeInvocations=lambda.commandCalls(InvokeCommand).length-beforeRepeatedAdmission;
  assert.equal(repeatedResumeInvocations,1);
  const admitted=await get('RESUMES_TABLE',{resumeId:'repeat-request'});
  assert.equal(admitted.parseWorkerJob.s3VersionId,'version-1');
  assert.equal(admitted.parseWorkerJob.parseAttemptId,admitted.parseAttemptId);
  pass('ten concurrent resume API requests admit one pinned worker');
  const model=require('../backend/src/models/resume');
  const owners=await Promise.all(Array.from({length:10},()=>model.claimResumeExecution('repeat-request','u','synthetic.pdf',admitted.parseAttemptId)));
  assert.equal(owners.filter(result=>result.claimed).length,1);
  const owner=owners.find(result=>result.claimed).owner;
  const stale=await model.updateResumeParsingResult('repeat-request','PARSED',{name:'stale'},null,'u',admitted.parseAttemptId,{leaseOwner:'stale-owner'});
  assert.equal(stale.skipped,true);
  const wrongAttempt=await model.claimResumeExecution('repeat-request','u','synthetic.pdf','stale-attempt');assert.equal(wrongAttempt.claimed,false);
  const parsed=await model.updateResumeParsingResult('repeat-request','PARSED',{name:'synthetic'},null,'u',admitted.parseAttemptId,{leaseOwner:owner});assert.equal(parsed.success,true);
  const lateFailure=await model.updateResumeParsingResult('repeat-request','FAILED',null,'late error','u',admitted.parseAttemptId,{leaseOwner:owner});assert.equal(lateFailure.skipped,true);
  const duplicate=await model.claimResumeExecution('repeat-request','u','synthetic.pdf',admitted.parseAttemptId);assert.equal(duplicate.claimed,false);
  pass('ten duplicate async deliveries share one owner; stale commits and attempts are fenced');
  assert.equal((await resumeApi(request)).statusCode,200);
  assert.equal(lambda.commandCalls(InvokeCommand).length-beforeRepeatedAdmission,1);
  pass('completed resume requests never restart paid processing');
  console.log(JSON.stringify({database:awsIsolated?'AWS isolated DynamoDB':'DynamoDB Local',realTransactions:true,productionDataTouched:false,checks,findings:[]}));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(awsIsolated)for(const TableName of created){
    try{if(!TableName.startsWith(prefix+'-'))throw Error('Unsafe cleanup target');await raw.send(new DeleteTableCommand({TableName}));}
    catch(error){console.error('Synthetic table cleanup failed:',TableName,error.name);process.exitCode=1;}
  }
  raw.destroy();sqs.restore();lambda.restore();sns.restore();
});
