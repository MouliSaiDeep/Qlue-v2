const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const deadline=require('./deadline');
const client=new LambdaClient({maxAttempts:1,requestHandler:{connectionTimeout:1500,requestTimeout:6000}});
async function readyWithoutNestedLambda(userId,sessionId){
  if(!process.env.STT_SESSIONS_TABLE||!/^wss:\/\/[a-zA-Z0-9.-]+(?::443)?\/audio$/.test(process.env.STT_GATEWAY_URL||''))return null;
  const ddb=require('./dynamodb'),{GetCommand,UpdateCommand}=require('@aws-sdk/lib-dynamodb');
  const control=(await deadline.sendBounded(ddb.docClient,new GetCommand({TableName:process.env.STT_SESSIONS_TABLE,Key:{pk:'CONTROL'},ConsistentRead:true}))).Item;
  if(control?.rolloutEnabled!==true||!/^i-[a-f0-9]{8,17}$/.test(control.hostInstanceId||''))return null;
  try{
    // Preserve the watchdog's shutdown claim and the same owned-session and
    // deletion fences while extending demand directly in the caller.
    await ddb.fencedSend(new UpdateCommand({TableName:process.env.STT_SESSIONS_TABLE,Key:{pk:'HOST#'+control.hostInstanceId},
      UpdateExpression:'SET wakeUntil = :until',ConditionExpression:'attribute_not_exists(stopToken)',ExpressionAttributeValues:{':until':Math.floor(Date.now()/1000)+300}}),userId,[{ConditionCheck:{
      TableName:process.env.SESSIONS_TABLE,Key:{sessionId},ConditionExpression:'userId = :uid AND currentState = :state',ExpressionAttributeValues:{':uid':userId,':state':'USER_RESPONDING'}
    }}]);
  }catch(error){if(error.name==='ConditionalCheckFailedException'){await require('./deletionJob').assertNotDeleting(userId);return false;}throw error;}
  const url=process.env.STT_GATEWAY_URL.replace(/^wss:/,'https:').replace(/\/audio$/,'/healthz');
  try{return await deadline.bounded(async signal=>{
    const response=await fetch(url,{signal,redirect:'error',headers:{'Cache-Control':'no-cache'}});
    if(response.status!==200){await response.body?.cancel();return false;}
    let text='';for await(const part of response.body){text+=Buffer.from(part).toString('utf8');if(Buffer.byteLength(text)>4096)throw Error('HEALTH_RESPONSE_LIMIT');}
    const health=JSON.parse(text);return health.ready===true&&health.sttEnabled===true&&health.hosting==='ondemand';
  },{deadlineAt:Math.min(deadline.absolute(),Date.now()+2500),label:'audioHostHealth'});}catch(_){return false;}
}
async function wake(userId,sessionId,{background=false}={}) {
  if(!process.env.AUDIO_HOST_WAKE_FUNCTION)return {ready:true};
  if(!background){
    const ready=await readyWithoutNestedLambda(userId,sessionId);
    if(ready===true)return {ready:true};
    if(ready===false){
      // An asynchronous wake can queue while callers release their Lambda
      // concurrency. Never make eight ticket Lambdas wait on eight more.
      try{await wake(userId,sessionId,{background:true});}catch(error){require('./logger').safeConsole.warn('Audio wake deferred',{name:error.name});}
      return {ready:false,code:'STT_GATEWAY_WARMING',retryAfterMs:3000};
    }
  }
  const result=await deadline.sendBounded(client,new InvokeCommand({FunctionName:process.env.AUDIO_HOST_WAKE_FUNCTION,
    InvocationType:background?'Event':'RequestResponse',Payload:Buffer.from(JSON.stringify({userId,sessionId}))}));
  if(background)return {queued:result.StatusCode===202};
  if(result.FunctionError)throw Error('AUDIO_HOST_UNAVAILABLE');
  return JSON.parse(Buffer.from(result.Payload||[]).toString());
}
module.exports={wake};
