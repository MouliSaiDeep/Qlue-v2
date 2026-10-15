const { SSMClient,GetParameterCommand }=require('@aws-sdk/client-ssm');
const { UpdateCommand }=require('@aws-sdk/lib-dynamodb');
const deadline=require('./deadline');
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
  // This budget counts attempts BEFORE provider invocation, including provider
  // failures and every retry. It is never refunded. Success quotas are separate.
  if(process.env.PAID_ATTEMPT_LIMIT!==undefined) {
    const limit=Number(process.env.PAID_ATTEMPT_LIMIT);
    if(!Number.isSafeInteger(limit)||limit<=0) throw new Error('Paid attempt budget is exhausted');
    const date=new Date().toISOString().slice(0,10);
    await deadline.sendBounded(require('./dynamodb').docClient,new UpdateCommand({
      TableName:process.env.USAGE_TABLE||'qlue-usage',Key:{userId:'BUDGET#GLOBAL',date},
      UpdateExpression:'SET expiresAt = :ttl ADD paidAttempts :one',
      ConditionExpression:'attribute_not_exists(paidAttempts) OR paidAttempts < :limit',
      ExpressionAttributeValues:{':ttl':Math.floor(Date.now()/1000)+172800,':one':1,':limit':limit}
    }),{label:'paidAttempt'});
  }
}
function resetCache(){cached=undefined;}
module.exports={assertRuntimeEnabled,beforePaidCall,resetCache};
