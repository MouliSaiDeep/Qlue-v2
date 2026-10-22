const { randomUUID } = require('node:crypto');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const ddb = require('./dynamodb');
const table = () => process.env.SESSIONS_TABLE || 'qlue-sessions';
async function currentAttempt(event) {
  await require('./deletionJob').assertNotDeleting(event.userId);
  const session = await require('../models/session').getSession(event.sessionId);
  if (!session || session.userId !== event.userId) return null;
  if (session.feedbackAttemptId && event.attemptId !== session.feedbackAttemptId) return null;
  return session;
}
async function claim(session, options={}) {
  const attemptId = randomUUID();
  const payload = { sessionId: session.sessionId, userId: session.userId, moduleType: session.moduleType, attemptId, reason: 'REGENERATED',...(options.retryReportId?{retryReportId:options.retryReportId}:{}) };
  const values = { ':pending':'PENDING', ':state':'GENERATING_FEEDBACK', ':attempt':attemptId, ':job':{status:'PENDING',attempts:0,payload}, ':now':Date.now(), ':observed':session.currentState };
  let condition = 'attribute_exists(sessionId) AND currentState = :observed';
  if (session.feedbackAttemptId) { condition += ' AND feedbackAttemptId = :old'; values[':old']=session.feedbackAttemptId; }
  else condition += ' AND attribute_not_exists(feedbackAttemptId)';
  if (session.feedbackStatus) { condition += ' AND feedbackStatus = :status'; values[':status']=session.feedbackStatus; }
  else condition += ' AND attribute_not_exists(feedbackStatus)';
  try {
    await ddb.fencedSend(new UpdateCommand({TableName:table(), Key:{sessionId:session.sessionId},
      UpdateExpression:'SET currentState = :state, feedbackStatus = :pending, feedbackAttemptId = :attempt, feedbackJob = :job, feedbackDispatchPending = :pending, feedbackJobUpdatedAt = :now, feedbackAttemptStartedAt = :now REMOVE feedbackId',
      ConditionExpression:condition,ExpressionAttributeValues:values}),session.userId);
    return {attemptId,payload};
  } catch(error) { if(error.name==='ConditionalCheckFailedException') return null; throw error; }
}
async function promote(event, report) {
  const values = { ':status':report.analysisStatus==='UNAVAILABLE'?'FAILED':'COMPLETE', ':id':report.feedbackId, ':ended':'TERMINATED' };
  let condition='attribute_exists(sessionId)';
  if(event.attemptId) { condition+=' AND feedbackAttemptId = :attempt'; values[':attempt']=event.attemptId; }
  else condition+=' AND attribute_not_exists(feedbackAttemptId)';
  let expression='SET feedbackStatus = :status, feedbackId = :id, currentState = :ended';
  if(report.analysisStatus!=='UNAVAILABLE'&&report.dimensionScores) { expression+=', accumulatedScores = :scores';values[':scores']=report.dimensionScores; }
  if(report.analysisStatus==='OK'&&report.reportVersion==='content-rubric-v2') {
    expression+=', assessmentOverallScore = :overall';values[':overall']=report.overallScore;
  }
  if(report.deliveryMeasurements) {expression+=', deliveryMeasurements = :delivery';values[':delivery']=report.deliveryMeasurements;}
  if(process.env.ANSWER_AUDIO_BUCKET) {expression+=', answerAudioClosed = :audioClosed, answerAudioCleanupPending = :audioClosed';values[':audioClosed']=true;}
  expression+=' REMOVE feedbackDispatchPending';
  // A failed final assessment must not leave earlier provisional scores in
  // dashboard averages. Canonical report/attempt fencing still owns this write.
  if (report.analysisStatus === 'UNAVAILABLE') expression += ', accumulatedScores, assessmentOverallScore';
  await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId:event.sessionId},UpdateExpression:expression,ConditionExpression:condition,ExpressionAttributeValues:values}),event.userId);
}
module.exports={currentAttempt,claim,promote};
