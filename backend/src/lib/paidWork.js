const { SSMClient,GetParameterCommand }=require('@aws-sdk/client-ssm');
const { UpdateCommand }=require('@aws-sdk/lib-dynamodb');
const deadline=require('./deadline');
const {QlueError,ERROR_CODES}=require('./errors');
const ssm=new SSMClient({maxAttempts:2});
let cached;
function disabled(value,action) {
  const flag=String(value||'').trim().toLowerCase();
  return ['all','true','1'].includes(flag)||flag.split(',').map(x=>x.trim()).includes(action.toLowerCase());
}
async function assertRuntimeEnabled(action) {
  const key=process.env.PAID_OPS_SWITCH_PARAMETER;
  let flag=process.env.QLUE_PAID_OPS_DISABLED||'';
  if(key) {
    if(!cached||cached.key!==key||cached.until<Date.now()) {
      const result=await deadline.sendBounded(ssm,new GetParameterCommand({Name:key}),{label:'stopSwitch',deadlineAt:Math.min(deadline.absolute(),Date.now()+2000)});
      if(typeof result.Parameter?.Value!=='string') throw new Error('Operational stop configuration is unavailable');
      cached={key,value:result.Parameter.Value,until:Date.now()+15000};
    }
    flag=cached.value||flag;
  }
  if(disabled(flag,action)) {const e=new Error('This feature is temporarily paused. Please try later.');e.code='SERVICE_PAUSED';e.statusCode=503;throw e;}
}
async function beforePaidCall(action) {
  action=deadline.current()?.action || action;
  await assertRuntimeEnabled(action);
  const userId=deadline.current()?.userId;
  if(userId) await require('./deletionJob').assertNotDeleting(userId);
  // Interview admission separately reserves one of this user's ten sessions.
  // A provider call is NOT an interview: one session needs several LLM/TTS
  // requests. Never make users compete with each other or with operator tests.
  // Keep retry/loop protection, scoped to the same user row as their quotas so
  // account deletion also removes this usage. Unowned system/test calls retain
  // the legacy small cap on their own row; users never consume that counter.
  if(process.env.PAID_ATTEMPT_LIMIT!==undefined||process.env.USER_PAID_ATTEMPT_LIMIT!==undefined) {
    const limit=Number(userId ? process.env.USER_PAID_ATTEMPT_LIMIT??500 : process.env.PAID_ATTEMPT_LIMIT??50);
    const exhausted=()=>new QlueError('Daily provider request limit reached. Please try after the daily reset.',ERROR_CODES.QUOTA_EXCEEDED,429);
    if(!Number.isSafeInteger(limit)||limit<=0)throw exhausted();
    const date=new Date().toISOString().slice(0,10);
    const command=new UpdateCommand({
      TableName:process.env.USAGE_TABLE||'qlue-usage',Key:{userId:userId||'BUDGET#GLOBAL',date},
      UpdateExpression:'SET expiresAt = :ttl ADD paidAttempts :one',
      ConditionExpression:'attribute_not_exists(paidAttempts) OR paidAttempts < :limit',
      ExpressionAttributeValues:{':ttl':Math.floor(Date.now()/1000)+172800,':one':1,':limit':limit}
    });
    try {
      if(userId)await require('./dynamodb').fencedSend(command,userId);
      else await deadline.sendBounded(require('./dynamodb').docClient,command,{label:'paidAttempt'});
    }catch(error){
      if(error.name==='ConditionalCheckFailedException')throw exhausted();
      throw error;
    }
  }
}
function resetCache(){cached=undefined;}
module.exports={assertRuntimeEnabled,beforePaidCall,resetCache};
