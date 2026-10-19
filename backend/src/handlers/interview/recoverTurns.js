const { SQSClient,SendMessageCommand } = require('@aws-sdk/client-sqs');
const {sendBounded}=require('../../lib/deadline');
const work=require('../../lib/eventWork');
const sqs=new SQSClient({maxAttempts:2});

async function processJob(task) {
  if(!task.sessionId)throw new Error('Turn sessionId is required');
  const session=await work.read(process.env.SESSIONS_TABLE||'qlue-sessions',{sessionId:task.sessionId});
  if(!session||!['INITIALIZING','PROCESSING_RESPONSE','LOADING_CONTEXT'].includes(session.currentState))return;
  if(task.jobId&&task.jobId!==session.jobId)return;
  await require('../../lib/deletionJob').assertNotDeleting(session.userId);
  if(session.leaseExpiresAt>Date.now())return work.enqueue(task,session.leaseExpiresAt+1);
  const age=Date.now()-work.timestamp(session.updatedAt||session.startTime,session.startedAt);
  if((session.jobAttemptCount||0)>=3||age>12*60000||(task.checks||0)>=10) {
    await require('../../models/session').updateSessionState(session.sessionId,'ERROR',session.currentState,{
      expectedVersion:session.version,guardUserId:session.userId,terminationReason:'TURN_RECOVERY_EXHAUSTED'});
    return;
  }
  const job=session.pendingJob||(session.currentState==='INITIALIZING'?{
    sessionId:session.sessionId,userId:session.userId,connectionId:session.connectionId,
    action:'session_init',jobId:`${session.sessionId}#session_init#0`
  }:null);
  if(!job) {
    await require('../../models/session').updateSessionState(session.sessionId,'ERROR',session.currentState,{
      expectedVersion:session.version,guardUserId:session.userId,terminationReason:'TURN_RECOVERY_PAYLOAD_MISSING'});
    return;
  }
  await sendBounded(sqs,new SendMessageCommand({QueueUrl:process.env.ASYNC_QUEUE_URL,MessageBody:JSON.stringify(job)}));
  await work.enqueue({sessionId:session.sessionId,jobId:session.jobId,checks:(task.checks||0)+1},Date.now()+75000);
}

exports.handler=work.handler({worker:'turn',process:processJob,direct:processJob});
