const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient,SendMessageCommand } = require('@aws-sdk/client-sqs');
const {sendBounded,withDeadline,remaining}=require('../../lib/deadline');
const sqs=new SQSClient({maxAttempts:2});
exports.handler=(event,context)=>withDeadline(context,async()=>{
  return require('../../lib/recoveryScan').sweep({table:process.env.SESSIONS_TABLE||'qlue-sessions',name:'turns',
    filter:'currentState IN (:init,:processing,:loading) AND (attribute_not_exists(leaseExpiresAt) OR leaseExpiresAt <= :now)',
    values:{':init':'INITIALIZING',':processing':'PROCESSING_RESPONSE',':loading':'LOADING_CONTEXT',':now':Date.now()},
    visit:async session=>{
      await require('../../lib/deletionJob').assertNotDeleting(session.userId).then(async()=>{
        const age=Date.now()-Date.parse(session.updatedAt||session.startTime||new Date().toISOString());
        if((session.jobAttemptCount||0)>=3 || age>12*60000) {
          await require('../../models/session').updateSessionState(session.sessionId,'ERROR',session.currentState,{
            expectedVersion:session.version,guardUserId:session.userId,terminationReason:'TURN_RECOVERY_EXHAUSTED'});
          return;
        }
        const job=session.pendingJob||{sessionId:session.sessionId,userId:session.userId,connectionId:session.connectionId,action:'session_init',jobId:`${session.sessionId}#session_init#0`};
        await sendBounded(sqs,new SendMessageCommand({QueueUrl:process.env.ASYNC_QUEUE_URL,MessageBody:JSON.stringify(job)}));
      }).catch(error=>{if(error.code!=='ACCOUNT_DELETING'&&error.name!=='ConditionalCheckFailedException') throw error;});
    }});
},{maxMs:60000});
