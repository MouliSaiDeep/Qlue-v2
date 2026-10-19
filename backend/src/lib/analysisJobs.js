const diagnostics=require('./logger').safeConsole;
const { randomUUID }=require('node:crypto');
const { PutCommand,GetCommand,UpdateCommand,ScanCommand }=require('@aws-sdk/lib-dynamodb');
const { LambdaClient,InvokeCommand }=require('@aws-sdk/client-lambda');
const ddb=require('./dynamodb');
const deadline=require('./deadline');
const response=require('./response');
const client=new LambdaClient({maxAttempts:2});
const table=()=>process.env.ANALYSIS_JOBS_TABLE||'qlue-analysis-jobs';
async function publish(jobId) {
  await deadline.sendBounded(client,new InvokeCommand({FunctionName:process.env.ANALYSIS_WORKER_LAMBDA,InvocationType:'Event',Payload:Buffer.from(JSON.stringify({jobId}))}));
}
async function admit(kind,event) {
  const userId=event.requestContext?.authorizer?.uid;
  if(!userId) return response.unauthorized('Please sign in');
  const upgrade=require('./protocol').requireProtocol(event);if(upgrade) return upgrade;
  await require('./deletionJob').assertNotDeleting(userId);
  require('./quota').assertAccountActive(await require('../models/user').getUserById(userId));
  await require('./paidWork').assertRuntimeEnabled(kind==='jd'?'jdAnalysis':'scrape');
  if(Buffer.byteLength(event.body||'')>30000) return response.badRequest('Analysis input is too large');
  try {JSON.parse(event.body||'{}');} catch(_) {return response.badRequest('Invalid request body');}
  // The paid worker reserves the success quota. Admission itself is bounded to
  // prevent an account flooding durable storage before workers catch up.
  const quota=await require('./quota').reserveQuota(userId,'analysisAdmission');
  if(!quota.allowed) return response.tooManyRequests('Daily analysis request limit reached','QUOTA_EXCEEDED');
  const jobId=randomUUID();
  await ddb.fencedSend(new PutCommand({TableName:table(),Item:{jobId,userId,kind,body:event.body,status:'PENDING',createdAt:Date.now(),expiresAt:Math.floor(Date.now()/1000)+86400},ConditionExpression:'attribute_not_exists(jobId)'}),userId);
  try {await publish(jobId);} catch(error) {diagnostics.warn('Analysis publication pending; recovery sweep will retry');}
  return response.success({jobId,status:'PENDING'},202);
}
async function admission(kind,event) {
  try {return await admit(kind,event);} catch(error) {
    if(error.code==='ACCOUNT_DELETING') return response.conflict('Account deletion is in progress','ACCOUNT_DELETING');
    if(error.code==='SERVICE_PAUSED') return response.serviceUnavailable('Analysis is temporarily paused. Please retry later.','SERVICE_PAUSED');
    throw error;
  }
}
async function get(jobId){return (await deadline.sendBounded(ddb.docClient,new GetCommand({TableName:table(),Key:{jobId},ConsistentRead:true}))).Item;}
async function failExpired(job) {
  if(job.status==='RUNNING' && job.leaseExpiresAt>Date.now()) return false;
  if((job.attemptCount||0)<3 && (!job.createdAt || Date.now()-job.createdAt<15*60000)) return false;
  await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{jobId:job.jobId},
    UpdateExpression:'SET #s = :failed, #result = :result REMOVE #body',
    ConditionExpression:'attribute_exists(jobId) AND (#s = :pending OR (#s = :running AND leaseExpiresAt <= :now))',
    ExpressionAttributeNames:{'#s':'status','#result':'result','#body':'body'},ExpressionAttributeValues:{':failed':'FAILED',':pending':'PENDING',':running':'RUNNING',':now':Date.now(),':result':response.serviceUnavailable('Analysis recovery was exhausted. Submit a new request.','ANALYSIS_RECOVERY_EXHAUSTED')}}),job.userId);
  return true;
}
async function run(jobId) {
  const job=await get(jobId);
  if(!job||['COMPLETE','FAILED'].includes(job.status)) return;
  await require('./deletionJob').assertNotDeleting(job.userId);
  if(await failExpired(job)) return;
  const owner=randomUUID(),now=Date.now();
  try {await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{jobId},
    UpdateExpression:'SET #s = :running, leaseOwner = :owner, leaseExpiresAt = :expiry, attemptCount = if_not_exists(attemptCount,:zero) + :one',
    ConditionExpression:'attribute_exists(jobId) AND (attribute_not_exists(attemptCount) OR attemptCount < :max) AND (#s = :pending OR (#s = :running AND leaseExpiresAt < :now))',
    ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':zero':0,':one':1,':max':3,':running':'RUNNING',':pending':'PENDING',':owner':owner,':expiry':now+130000,':now':now}}),job.userId);
  }catch(error){if(error.name==='ConditionalCheckFailedException') return;throw error;}
  const ctx=deadline.current();if(ctx) {ctx.userId=job.userId;ctx.action=job.kind==='jd'?'jdAnalysis':'scrape';}
  const implementation=job.kind==='jd'?require('../handlers/jd/analyzeJobMatch'):require('../handlers/website/validateWebsite');
  const handler=implementation.processAnalysis||implementation.handler;
  let result;
  try {result=await handler({requestContext:{authorizer:{uid:job.userId}},body:job.body});}
  catch(error){result=response.internalError('Analysis could not complete. Please retry.');}
  await deadline.finalize(()=>ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{jobId},
    UpdateExpression:'SET #s = :status, #result = :result REMOVE #body',
    ConditionExpression:'attribute_exists(jobId) AND leaseOwner = :owner',
    ExpressionAttributeNames:{'#s':'status','#result':'result','#body':'body'},
    ExpressionAttributeValues:{':status':result.statusCode>=400?'FAILED':'COMPLETE',':result':result,':owner':owner}}),job.userId));
}
async function recover() {
  let key;
  do {const page=await deadline.sendBounded(ddb.docClient,new ScanCommand({TableName:table(),Limit:100,ExclusiveStartKey:key,
    FilterExpression:'#s = :pending OR (#s = :running AND leaseExpiresAt < :now)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':pending':'PENDING',':running':'RUNNING',':now':Date.now()}}));
    for(const job of page.Items||[]) {
      if(deadline.remaining()<5000) return;
      try {
        await require('./deletionJob').assertNotDeleting(job.userId);
        if(!await failExpired(job)) await publish(job.jobId);
      }catch(error) {if(!['ACCOUNT_DELETING','ConditionalCheckFailedException'].includes(error.code||error.name)) throw error;}
    }
    key=page.LastEvaluatedKey;
  }while(key&&deadline.remaining()>5000);
}
module.exports={admission,get,run,recover};
