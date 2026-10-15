const { ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('node:crypto');
const ddb = require('../../lib/dynamodb');
const { sendBounded, withDeadline, remaining } = require('../../lib/deadline');
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
      UpdateExpression:'SET notificationStatus = :sending, notificationOwner = :owner, notificationExpiresAt = :expiry',
      ConditionExpression:'attribute_exists(feedbackId) AND (notificationStatus = :pending OR (notificationStatus = :sending AND notificationExpiresAt < :now))',
      ExpressionAttributeValues:{':sending':'SENDING',':pending':'PENDING',':owner':owner,':expiry':Date.now()+75000,':now':Date.now()}}),report.userId);
  } catch(error) {if(error.name==='ConditionalCheckFailedException') return;throw error;}
  const attempts=(report.notificationAttempts||0)+1;
  try {
    const result=await require('./sendFeedbackNotification').handler(report);
    await updateDelivery(report,result.success?'DELIVERED':'FAILED',attempts,owner);
  } catch(error) {
    await updateDelivery(report,attempts>=5?'FAILED':'PENDING',attempts,owner);
  }
}
async function sweep(table,filter,values,fn) {
  return require('../../lib/recoveryScan').sweep({table,keyName:table===feedback()?'feedbackId':'sessionId',
    name:filter.startsWith('feedbackStatus')?'feedback-aged':filter.startsWith('answerAudio')?'audio-cleanup':'notification',
    filter,values,visit:fn});
}
exports.handler=(event,context)=>withDeadline(context,async()=>{
  // This backstop also reflects exhausted downstream async retries/DLQs to the
  // user. Lambda retries have a finite maximum event age of ten minutes.
  await sweep(sessions(),'feedbackStatus = :pending AND feedbackAttemptStartedAt < :cutoff',
    {':pending':'PENDING',':cutoff':Date.now()-12*60000}, async row=>{
      try {await ddb.fencedSend(new UpdateCommand({TableName:sessions(),Key:{sessionId:row.sessionId},
        UpdateExpression:'SET feedbackStatus = :failed REMOVE feedbackDispatchPending',
        ConditionExpression:'feedbackStatus = :pending AND feedbackAttemptId = :attempt',
        ExpressionAttributeValues:{':failed':'FAILED',':pending':'PENDING',':attempt':row.feedbackAttemptId}}),row.userId);
      } catch(error) {if(error.name!=='ConditionalCheckFailedException') throw error;}
    });
  if(process.env.ANSWER_AUDIO_BUCKET) {
    await sweep(sessions(),'answerAudioCleanupPending = :yes OR (attribute_exists(answerAudio) AND startedAt < :old)',{':yes':true,':old':Date.now()-6*60*60000},async row=>{
      try {const audio=require('../../lib/answerAudio');if(row.answerAudioClosed)await audio.cleanup(row);else await audio.close(row);}
      catch(_) {require('../../lib/logger').safeConsole.warn('Answer audio cleanup will retry');}
    });
  }
  await sweep(feedback(),'notificationStatus = :pending OR (notificationStatus = :sending AND notificationExpiresAt < :now)',{':pending':'PENDING',':sending':'SENDING',':now':Date.now()},deliver);
},{maxMs:60000});
exports.deliver=deliver;
