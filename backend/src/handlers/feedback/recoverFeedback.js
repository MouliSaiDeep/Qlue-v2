const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('node:crypto');
const ddb = require('../../lib/dynamodb');
const work = require('../../lib/eventWork');
const sessions = () => process.env.SESSIONS_TABLE || 'qlue-sessions';
const feedback = () => process.env.FEEDBACK_TABLE || 'qlue-feedback';
async function updateDelivery(report,status,attempts,owner) {
  await ddb.fencedSend(new UpdateCommand({TableName:feedback(),Key:{feedbackId:report.feedbackId},
    UpdateExpression:'SET notificationStatus = :status, notificationAttempts = :attempts REMOVE notificationOwner, notificationExpiresAt',
    ConditionExpression:'attribute_exists(feedbackId) AND notificationOwner = :owner',
    ExpressionAttributeValues:{':status':status,':attempts':attempts,':owner':owner}}),report.userId);
}
async function deliver(report) {
  if(!await require('../../lib/feedbackAttempt').currentAttempt(report)) return;
  const owner=randomUUID();
  try {
    await ddb.fencedSend(new UpdateCommand({TableName:feedback(),Key:{feedbackId:report.feedbackId},
    UpdateExpression:'SET notificationStatus = :sending, notificationOwner = :owner, notificationExpiresAt = :expiry, notificationAttempts = :attempts',
    ConditionExpression:'attribute_exists(feedbackId) AND (attribute_not_exists(notificationAttempts) OR notificationAttempts < :max) AND (attribute_not_exists(notificationAttempts) OR notificationAttempts = :observed) AND (notificationStatus = :pending OR (notificationStatus = :sending AND notificationExpiresAt < :now))',
    ExpressionAttributeValues:{':sending':'SENDING',':pending':'PENDING',':owner':owner,':expiry':Date.now()+75000,':now':Date.now(),':attempts':(report.notificationAttempts||0)+1,':observed':report.notificationAttempts||0,':max':5}}),report.userId);
  } catch(error) {if(error.name==='ConditionalCheckFailedException') return;throw error;}
  const attempts=(report.notificationAttempts||0)+1;
  try {
    const result=await require('./sendFeedbackNotification').handler(report);
    await updateDelivery(report,result.success?'DELIVERED':'FAILED',attempts,owner);
  } catch(error) {
    await updateDelivery(report,attempts>=5?'FAILED':'PENDING',attempts,owner);
  }
}
async function processJob(task) {
  if(task.kind==='notification') {
    if(!task.feedbackId)throw new Error('Feedback ID is required');
    const report=await work.read(feedback(),{feedbackId:task.feedbackId});
    if(!report||!['PENDING','SENDING'].includes(report.notificationStatus))return;
    if(report.notificationStatus==='SENDING'&&report.notificationExpiresAt>=Date.now()) {
      return work.enqueue(task,report.notificationExpiresAt+1);
    }
    if((report.notificationAttempts||0)>=5) {
      await ddb.fencedSend(new UpdateCommand({TableName:feedback(),Key:{feedbackId:report.feedbackId},
        UpdateExpression:'SET notificationStatus = :failed REMOVE notificationOwner, notificationExpiresAt',
        ConditionExpression:'notificationAttempts >= :max AND (notificationStatus = :pending OR (notificationStatus = :sending AND notificationExpiresAt < :now))',
        ExpressionAttributeValues:{':failed':'FAILED',':pending':'PENDING',':sending':'SENDING',':now':Date.now(),':max':5}}),report.userId);
      return;
    }
    return deliver(report);
  }
  if(!task.sessionId)throw new Error('Feedback recovery sessionId is required');
  const row=await work.read(sessions(),{sessionId:task.sessionId});
  if(!row)return;
  await require('../../lib/deletionJob').assertNotDeleting(row.userId);
  if(task.kind==='feedbackTimeout') {
    if(row.feedbackStatus!=='PENDING'||row.feedbackAttemptId!==task.attemptId)return;
    const dueAt=work.timestamp(row.feedbackAttemptStartedAt)+12*60000+1;
    if(dueAt>Date.now())return work.enqueue(task,dueAt);
    const attemptCondition=row.feedbackAttemptId?'feedbackAttemptId = :attempt':'attribute_not_exists(feedbackAttemptId)';
    await ddb.fencedSend(new UpdateCommand({TableName:sessions(),Key:{sessionId:row.sessionId},
      UpdateExpression:'SET feedbackStatus = :failed REMOVE feedbackDispatchPending',
      ConditionExpression:`feedbackStatus = :pending AND ${attemptCondition}`,
      ExpressionAttributeValues:{':failed':'FAILED',':pending':'PENDING',...(row.feedbackAttemptId?{':attempt':row.feedbackAttemptId}:{})}}),row.userId);
  } else if(task.kind==='audioCleanup') {
    if(!process.env.ANSWER_AUDIO_BUCKET||!row.answerAudio)return;
    const dueAt=row.answerAudioCleanupPending?(row.answerAudioLastExpiry||0)+90001:work.timestamp(row.startedAt)+6*60*60000+1;
    if(dueAt>Date.now())return work.enqueue(task,dueAt);
    const audio=require('../../lib/answerAudio');
    if(row.answerAudioClosed)await audio.cleanup(row);else await audio.close(row);
  } else throw new Error('Unknown feedback recovery task');
}

exports.handler=work.handler({worker:'feedback',
  onStream:async(report,old)=>{
    if(!report.feedbackId||!['PENDING','SENDING'].includes(report.notificationStatus)||
      !work.changed(report,old,['notificationStatus','notificationExpiresAt','notificationAttempts']))return;
    const dueAt=report.notificationStatus==='SENDING'?report.notificationExpiresAt+1:
      Date.now()+((report.notificationAttempts||0)?30000:0);
    await work.enqueue({kind:'notification',feedbackId:report.feedbackId},dueAt);
  },
  process:processJob,
  direct:processJob
});
exports.deliver=deliver;
