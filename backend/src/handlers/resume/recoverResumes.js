const {UpdateCommand}=require('@aws-sdk/lib-dynamodb');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const ddb=require('../../lib/dynamodb'),deadline=require('../../lib/deadline');
const work=require('../../lib/eventWork');
const lambda=new LambdaClient({maxAttempts:1});
const table=()=>process.env.RESUMES_TABLE||'qlue-resumes';
const expires=resume=>Math.max(work.timestamp(resume.claimedAt||resume.updatedAt,0),resume.parseLeaseExpiresAt||0)+3*60000+1;
async function processJob({resumeId,attemptId}) {
   if(!resumeId)throw new Error('Resume ID is required');
   const resume=await work.read(table(),{resumeId});
   if(!resume||resume.status!=='PARSING'||resume.parseAttemptId!==attemptId)return;
   if(expires(resume)>Date.now())return work.enqueue({resumeId,attemptId},expires(resume));
    await require('../../lib/deletionJob').assertNotDeleting(resume.userId);
    // Expired invocation: re-run the stored immutable request, or surface a
    // terminal failure for legacy claims that have no recoverable payload.
    const attempts=(resume.parseRecoveryAttempts||0)+1;
    const attemptCondition=resume.parseAttemptId?'parseAttemptId = :id':'attribute_not_exists(parseAttemptId)';
    const claimCondition=resume.claimedAt!==undefined?'claimedAt = :observed':'attribute_not_exists(claimedAt)';
    const observed={...(resume.parseAttemptId?{':id':resume.parseAttemptId}:{}),
      ...(resume.claimedAt!==undefined?{':observed':resume.claimedAt}:{})};
    const job=resume.parseWorkerJob||(resume.s3Key?{isAsyncWorker:true,resumeId,userId:resume.userId,s3Key:resume.s3Key,
      ...(resume.parseAttemptId?{parseAttemptId:resume.parseAttemptId}:{})}:null);
    if(!job||attempts>3) {
     await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{resumeId},
       UpdateExpression:'SET #s = :failed, failReason = :reason, updatedAt = :now',
       ConditionExpression:`#s = :parsing AND ${attemptCondition} AND ${claimCondition}`,
       ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':failed':'FAILED',':parsing':'PARSING',
         ':reason':'Processing did not complete. Please retry.',':now':new Date().toISOString(),...observed}}),resume.userId);
     return;
    }
    await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{resumeId},
      UpdateExpression:'SET claimedAt = :now, parseRecoveryAttempts = :attempts',
      ConditionExpression:`#s = :parsing AND ${attemptCondition} AND ${claimCondition}`,
      ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':now':Date.now(),':attempts':attempts,':parsing':'PARSING',
        ...observed}}),resume.userId);
    await deadline.sendBounded(lambda,new InvokeCommand({FunctionName:process.env.RESUME_WORKER_LAMBDA,InvocationType:'Event',Payload:Buffer.from(JSON.stringify(job))}));
}

exports.handler=work.handler({worker:'resume',
  onStream:async(resume,old)=>{
    if(!resume.resumeId||resume.status!=='PARSING'||
      !work.changed(resume,old,['status','claimedAt','parseAttemptId']))return;
    await work.enqueue({resumeId:resume.resumeId,attemptId:resume.parseAttemptId},expires(resume));
  },
  process:processJob,
  direct:processJob
});
