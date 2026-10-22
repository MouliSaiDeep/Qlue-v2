const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const assessment=require('../../lib/feedbackAssessment');
const lambda=new LambdaClient({region:process.env.AWS_REGION||'us-east-1',maxAttempts:1});
async function report(event) {
  if(!await require('../../lib/feedbackAttempt').currentAttempt(event))return {success:true,stale:true};
  let result=event.assessmentResult;
  // Pre-rollout jobs have no validated rubric result. Do not resurrect their
  // unvalidated marks or make an independent second model judgment.
  if(!result||result.reportVersion!==assessment.VERSION)result=assessment.unavailable('LEGACY_EVALUATION_RETRY_REQUIRED');
  if(result.analysisStatus==='OK') {
    result=assessment.verifyReport(result,event.moduleType);
  } else if(result.analysisStatus!=='UNAVAILABLE')throw Error('Invalid assessment status');
  else result=assessment.unavailable(result.assessment?.reason||'EVALUATION_UNAVAILABLE');
  const payload={...result,sessionId:event.sessionId,userId:event.userId,attemptId:event.attemptId,
    moduleType:event.moduleType,sessionMetadata:event.metadata};
  await require('../../lib/deadline').sendBounded(lambda,new InvokeCommand({
    FunctionName:process.env.STORE_FEEDBACK_LAMBDA,InvocationType:'Event',Payload:Buffer.from(JSON.stringify(payload))
  }));
  return {success:true,sessionId:event.sessionId};
}
exports.handler=(event,context)=>require('../../lib/deadline').withDeadline(context,()=>report(event),{maxMs:25000,userId:event.userId});
