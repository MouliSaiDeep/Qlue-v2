const {invokeModel}=require('../../lib/bedrock');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const assessment=require('../../lib/feedbackAssessment');
const deadline=require('../../lib/deadline');
const lambda=new LambdaClient({region:process.env.AWS_REGION||'us-east-1',maxAttempts:1});
async function analyze(event) {
  const live=await require('../../lib/feedbackAttempt').currentAttempt(event);
  if(!live)return {success:true,stale:true};
  let prepared,result;
  try {
    if(event.assessmentInputLimitExceeded)throw new assessment.InvalidAssessment('INPUT_LIMIT');
    let answerPairs=event.answerPairs;
    if(!answerPairs) {
      // Old queued jobs are rebuilt from accepted records, never parsed from
      // role-like strings that may occur inside a candidate's answer.
      const rows=await require('../../models/transcript').getTranscriptBySession(event.sessionId);
      answerPairs=assessment.pairs(require('../../lib/feedbackTranscript').select(live,rows));
    }
    if(live.answerIdentityVersion===1) {
      const ids=new Set(live.acceptedAnswerIds||[]);
      if(answerPairs.length!==ids.size||answerPairs.some(a=>!ids.has(a.answerId)))throw new assessment.InvalidAssessment('ANSWER_MANIFEST_MISMATCH');
    }
    prepared=assessment.prepare({...event,moduleType:live.moduleType||event.moduleType,answerPairs,
      assessmentContext:require('../../lib/feedbackTranscript').assessmentContext(live)});
  } catch(error) {
    if(!(error instanceof assessment.InvalidAssessment))throw error;
    result=assessment.unavailable(error.code);
  }
  if(prepared) {
    let previousIssue;
    for(let attempt=0;attempt<2;attempt++) {
      if(attempt&&deadline.remaining()<12000)break;
      try {
        const response=await invokeModel(undefined,assessment.prompt(prepared,previousIssue),{logTokens:true,retries:0});
        const validated=assessment.validate(response.content?.[0]?.text||'',prepared,{requireCoaching:true});
        result=assessment.report(prepared,validated);break;
      } catch(error) {
        if(['ACCOUNT_DELETING','SERVICE_PAUSED'].includes(error.code))throw error;
        if(error.code==='INSUFFICIENT_EVIDENCE') {result=assessment.unavailable(error.code);break;}
        previousIssue=error.code||error.name;
        require('../../lib/logger').safeConsole.warn('Feedback assessment attempt failed',{attempt:attempt+1,code:error.code||error.name});
      }
    }
    result ||= assessment.unavailable('EVALUATION_UNAVAILABLE');
  }
  const payload={sessionId:event.sessionId,userId:event.userId,attemptId:event.attemptId,
    moduleType:live.moduleType||event.moduleType,metadata:event.metadata,assessmentResult:result};
  if(!await require('../../lib/feedbackAttempt').currentAttempt(event))return {success:true,stale:true};
  await deadline.finalize(()=>deadline.sendBounded(lambda,new InvokeCommand({
    FunctionName:process.env.GENERATE_REPORT_LAMBDA,InvocationType:'Event',Payload:Buffer.from(JSON.stringify(payload))
  })));
  return {success:true,sessionId:event.sessionId,analysisStatus:result.analysisStatus,scores:result.dimensionScores};
}
exports.handler=(event,context)=>deadline.withDeadline(context,()=>analyze(event),{maxMs:60000,reserveMs:6000,userId:event.userId,action:'feedback'});
