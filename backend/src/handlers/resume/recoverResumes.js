const {ScanCommand,UpdateCommand}=require('@aws-sdk/lib-dynamodb');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const ddb=require('../../lib/dynamodb'),deadline=require('../../lib/deadline');
const lambda=new LambdaClient({maxAttempts:1});
const table=()=>process.env.RESUMES_TABLE||'qlue-resumes';
exports.handler=(event,context)=>deadline.withDeadline(context,async()=>{
 return require('../../lib/recoveryScan').sweep({table:table(),keyName:'resumeId',name:'resumes',
  filter:'#s = :parsing AND claimedAt < :cutoff',names:{'#s':'status'},values:{':parsing':'PARSING',':cutoff':Date.now()-3*60000},
  visit:async resume=>{
   try {
    await require('../../lib/deletionJob').assertNotDeleting(resume.userId);
    // Expired invocation: re-run the stored immutable request, or surface a
    // terminal failure for legacy claims that have no recoverable payload.
    const attempts=(resume.parseRecoveryAttempts||0)+1;
    if(!resume.parseWorkerJob||attempts>3) {
     await require('../../models/resume').updateResumeParsingResult(resume.resumeId,'FAILED',null,'Processing did not complete. Please retry.',resume.userId,resume.parseAttemptId);return;
    }
    await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{resumeId:resume.resumeId},UpdateExpression:'SET claimedAt = :now, parseRecoveryAttempts = :attempts',ConditionExpression:'#s = :parsing AND parseAttemptId = :id AND claimedAt = :observed',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':now':Date.now(),':attempts':attempts,':parsing':'PARSING',':id':resume.parseAttemptId,':observed':resume.claimedAt}}),resume.userId);
    await deadline.sendBounded(lambda,new InvokeCommand({FunctionName:process.env.RESUME_WORKER_LAMBDA,InvocationType:'Event',Payload:Buffer.from(JSON.stringify(resume.parseWorkerJob))}));
   } catch(error){if(error.code!=='ACCOUNT_DELETING'&&error.name!=='ConditionalCheckFailedException')throw error;}
  }});
},{maxMs:60000});
