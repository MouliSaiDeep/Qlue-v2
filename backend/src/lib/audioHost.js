const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const deadline=require('./deadline');
const client=new LambdaClient({maxAttempts:1,requestHandler:{connectionTimeout:1500,requestTimeout:6000}});
async function wake(userId,sessionId,{background=false}={}) {
  if(!process.env.AUDIO_HOST_WAKE_FUNCTION)return {ready:true};
  const result=await deadline.sendBounded(client,new InvokeCommand({FunctionName:process.env.AUDIO_HOST_WAKE_FUNCTION,
    InvocationType:background?'Event':'RequestResponse',Payload:Buffer.from(JSON.stringify({userId,sessionId}))}));
  if(background)return {queued:result.StatusCode===202};
  if(result.FunctionError)throw Error('AUDIO_HOST_UNAVAILABLE');
  return JSON.parse(Buffer.from(result.Payload||[]).toString());
}
module.exports={wake};
