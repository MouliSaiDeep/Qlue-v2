const diagnostics=require('../../lib/logger').safeConsole;
/**
 * Stream-driven feedback outbox dispatcher and session watchdog router.
 * SessionsTable contains the durable PENDING outbox; report inserts happen only
 * after generation has completed. Stream records arm delayed, per-session SQS
 * checks. Every check re-reads current state and respects attempt ownership.
 */
const { updateSessionState, getSession, INTERVIEW_STATES } = require('../../models/session');
const work = require('../../lib/eventWork');
const {
  FEEDBACK_JOB,
  DISPATCH_MARKER,
  MAX_DISPATCH_ATTEMPTS,
  buildFeedbackPayload,
  publishFeedbackJob,
  clampError
} = require('../../lib/feedbackDispatch');

// Wait for this grace window so recovery does not race the primary
// (duplicate-terminate) path for a job that was claimed moments ago.
const DISPATCH_GRACE_MS = parseInt(process.env.FEEDBACK_DISPATCH_GRACE_MS || '60000', 10);

// Finalize a published job to TERMINATED (drops the sparse marker via terminal
// cleanup in updateSessionState). Conditional on GENERATING_FEEDBACK so a job
// the primary path already finalized is never reopened.
async function finalize(sessionId, attemptId) {
  try {
    await updateSessionState(sessionId, INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK, {expectedFeedbackAttemptId:attemptId});
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

// Keep the job PENDING in the dispatch index after a failed re-publish, recording
// the bumped attempt count. Conditional on the row still being GENERATING_FEEDBACK.
async function keepPending(sessionId, payload, attempts, lastError, attemptId) {
  try {
    await updateSessionState(sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.GENERATING_FEEDBACK, {
      expectedFeedbackAttemptId:attemptId,
      feedbackJob: { status: FEEDBACK_JOB.PENDING, attempts, payload, lastError: clampError(lastError) },
      feedbackDispatchPending: DISPATCH_MARKER
    });
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

// Park a permanently-failing job: mark it FAILED and REMOVE the marker so it
// leaves the index and surfaces to ops. The session stays GENERATING_FEEDBACK
// (its activeMarker/lock were already cleared on first entry) — it is not
// finalized because feedback was never produced.
async function parkFailed(sessionId, payload, attempts, lastError, attemptId) {
  try {
    await updateSessionState(sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.GENERATING_FEEDBACK, {
      feedbackStatus: 'FAILED',
      expectedFeedbackAttemptId:attemptId,
      feedbackJob: { status: FEEDBACK_JOB.FAILED, attempts, payload, lastError: clampError(lastError) },
      feedbackDispatchPending: null
    });
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

async function dispatchOne(candidate, summary) {
  const sessionId = candidate.sessionId;
  // Re-read with a consistent read: the GSI is eventually consistent, so the
  // primary path may already have finalized/advanced this job.
  const session = await getSession(sessionId);
  if (!session || session.feedbackAttemptId !== candidate.feedbackAttemptId || session.currentState !== INTERVIEW_STATES.GENERATING_FEEDBACK) {
    summary.skipped++; // already finalized/advanced elsewhere
    return;
  }
  const job = session.feedbackJob;
  if (!job || job.status !== FEEDBACK_JOB.PENDING) {
    summary.skipped++; // nothing pending (parked, or legacy row with no outbox)
    return;
  }

  const payload = job.payload || buildFeedbackPayload(session, session.terminationReason);
  const attempts = (job.attempts || 0) + 1;
  try {
    const result = await publishFeedbackJob(payload);
    if (result.published === false && result.reason === 'NO_TOPIC') {
      // Keep the durable outbox pending when publication is unavailable.
      throw new Error('Feedback topic is unavailable');
    }
    await finalize(sessionId,session.feedbackAttemptId);
    summary.dispatched++;
  } catch (pubErr) {
    if (attempts >= MAX_DISPATCH_ATTEMPTS) {
      diagnostics.error(`[DispatchFeedback] Session ${sessionId} parked FAILED after ${attempts} attempts:`, pubErr.name);
      await parkFailed(sessionId, payload, attempts, pubErr.message,session.feedbackAttemptId);
      summary.failed++;
    } else {
      diagnostics.warn(`[DispatchFeedback] Re-publish failed for ${sessionId} (attempt ${attempts}); still PENDING:`, pubErr.name);
      await keepPending(sessionId, payload, attempts, pubErr.message,session.feedbackAttemptId);
      summary.deferred++;
    }
  }
}

async function processJob({sessionId,attemptId}) {
  if(!sessionId)throw new Error('Feedback sessionId is required');
  const session=await getSession(sessionId);
  if(!session||session.feedbackAttemptId!==attemptId||session.feedbackJob?.status!==FEEDBACK_JOB.PENDING||
    session.currentState!==INTERVIEW_STATES.GENERATING_FEEDBACK)return;
  const dueAt=work.timestamp(session.feedbackJobUpdatedAt)+DISPATCH_GRACE_MS+1;
  if(dueAt>Date.now())return work.enqueue({sessionId,attemptId},dueAt);
  const summary = { scanned: 0, dispatched: 0, deferred: 0, failed: 0, skipped: 0 };
  await dispatchOne(session,summary);
  return summary;
}

// One SessionsTable consumer routes all session watchdogs. This avoids three
// independent consumers reading the same shards, and arms timers even if the
// producer dies immediately after its durable write.
async function onStream(session,old) {
  if(!session.sessionId||!session.userId||session.recoveryCursor)return;
  const sessionId=session.sessionId,attemptId=session.feedbackAttemptId;
  if(session.feedbackDispatchPending===DISPATCH_MARKER&&session.feedbackJob?.status===FEEDBACK_JOB.PENDING&&
    work.changed(session,old,['feedbackDispatchPending','feedbackJobUpdatedAt','feedbackAttemptId'])) {
    await work.enqueue({sessionId,attemptId},work.timestamp(session.feedbackJobUpdatedAt)+DISPATCH_GRACE_MS+1);
  }
  if(session.feedbackStatus==='PENDING'&&
    work.changed(session,old,['feedbackStatus','feedbackAttemptId','feedbackAttemptStartedAt'])) {
    await work.enqueue({worker:'feedback',kind:'feedbackTimeout',sessionId,attemptId},
      work.timestamp(session.feedbackAttemptStartedAt)+12*60000+1,process.env.FEEDBACK_RECOVERY_QUEUE_URL);
  }
  if(['INITIALIZING','PROCESSING_RESPONSE','LOADING_CONTEXT'].includes(session.currentState)&&
    work.changed(session,old,['currentState','leaseExpiresAt','jobId'])) {
    await work.enqueue({worker:'turn',sessionId,jobId:session.jobId},Math.max(Date.now()+1000,session.leaseExpiresAt||
      work.timestamp(session.updatedAt||session.startTime,session.startedAt)+75000),process.env.TURN_RECOVERY_QUEUE_URL);
  }
  if(session.answerAudio&&(!old?.answerAudio||
    work.changed(session,old,['answerAudioCleanupPending','answerAudioClosed','answerAudioLastExpiry']))) {
    const dueAt=session.answerAudioCleanupPending?Math.max(Date.now(),(session.answerAudioLastExpiry||0)+90001):
      work.timestamp(session.startedAt)+6*60*60000+1;
    await work.enqueue({worker:'feedback',kind:'audioCleanup',sessionId},dueAt,process.env.FEEDBACK_RECOVERY_QUEUE_URL);
  }
}

exports.handler=work.handler({worker:'dispatch',onStream,process:processJob,direct:processJob});
