const { createFeedbackReport } = require('../../models/feedback');
const attempt = require('../../lib/feedbackAttempt');
exports.handler = async event => {
  if (!await attempt.currentAttempt(event)) return {success:true,stale:true};
  const result = await createFeedbackReport(event);
  if (!result.success) throw result.error || new Error('Feedback persistence failed');
  await attempt.promote(event, result.data);
  if(!result.duplicate)require('../../lib/metrics').recordMetrics('Feedback',{
    FeedbackStored:1,FeedbackUnavailable:Number(result.data?.analysisStatus==='UNAVAILABLE')});
  // Persist the report and close admission BEFORE deleting files. Purge failures
  // retain a durable cleanup marker; they must not hide a completed report.
  if(process.env.ANSWER_AUDIO_BUCKET) {
    try {const s=await require('../../lib/answerAudio').read(event.sessionId);if(s?.answerAudio)await require('../../lib/answerAudio').cleanup(s);}
    catch(_) {require('../../lib/logger').safeConsole.warn('Answer audio cleanup deferred');}
  }
  // Notification state is stored on the report by the same create. A duplicate
  // report retains PENDING delivery and is retried by the scheduled dispatcher.
  return {success:true,feedbackId:result.feedbackId};
};

const store=exports.handler;
exports.handler=(event,context)=>require('../../lib/deadline').withDeadline(context,()=>store(event),{maxMs:25000,userId:event.userId});
