const diagnostics=require('../../lib/logger').safeConsole;
const {
  getSessionById,
  INTERVIEW_STATES,
} = require('../../models/session');
const attempt = require('../../lib/feedbackAttempt');
const {
  success,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  serviceUnavailable,
  internalError
} = require('../../lib/response');

const IN_PROGRESS = { status: 'PENDING', regenerated: false, inProgress: true };

exports.handler = async (event) => {
  try {
    // 1. Authenticated caller (the REST authorizer injects uid; a missing one is
    //    a misconfiguration, not an anonymous caller — fail closed).
    const uid = event.requestContext?.authorizer?.uid;
    if (!uid) {
      diagnostics.error('[RegenerateFeedback] Missing user context');
      return unauthorized('Unauthorized: missing user context', 'UNAUTHORIZED');
    }

    // 2. Target session.
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (_) {
      return badRequest('Invalid request body', 'INVALID_BODY');
    }
    const sessionId = body.sessionId;
    if (!sessionId) {
      return badRequest('sessionId required', 'MISSING_SESSION_ID');
    }

        await require('../../lib/deletionJob').assertNotDeleting(uid);
    const session = await getSessionById(sessionId);
    if (!session) {
      return notFound('Session not found', 'SESSION_NOT_FOUND');
    }

    // 3. Ownership — never let one user regenerate (and wipe) another's report.
    if (session.userId !== uid) {
      diagnostics.warn(`[RegenerateFeedback] Ownership violation: user ${uid} attempted session owned by ${session.userId}`);
      return forbidden('You do not own this session', 'FORBIDDEN');
    }

    // 4. A discarded session (ended with no real answers) has nothing to score.
    if (session.discarded) {
      return conflict('This session was discarded and has no feedback to regenerate', 'CANNOT_REGENERATE');
    }

    // 5. The interview must have ended — otherwise there is no transcript to
    //    analyze yet and regeneration is meaningless.
    const state = session.currentState;
    if (state !== INTERVIEW_STATES.TERMINATED && state !== INTERVIEW_STATES.GENERATING_FEEDBACK) {
      return conflict('Interview has not ended yet', 'INTERVIEW_NOT_ENDED');
    }

    const status = session.feedbackStatus; // 'COMPLETE' | 'FAILED' | 'PENDING' | undefined
    let partial;
    if(status==='COMPLETE'&&session.feedbackId){
      const result=await require('../../lib/dynamodb').get(process.env.FEEDBACK_TABLE||'qlue-feedback',{feedbackId:session.feedbackId},{consistentRead:true});
      if(!result.success)throw result.error||Error('Feedback read failed');
      const saved=result.data;
      if(saved?.sessionId===sessionId&&saved.userId===uid&&saved.dimensionScores&&
        (saved.qualitativeStatus==='UNAVAILABLE'||body.refreshAssessment===true&&saved.reportVersion==='content-rubric-v2'&&
          saved.assessment?.coachingVersion!==require('../../lib/feedbackCoaching').VERSION))partial=saved;
    }

    // 6. Never wipe a report that actually succeeded.
    if (status === 'COMPLETE'&&!partial) {
      return success({ status: 'COMPLETE', regenerated: false }, 200);
    }

    // 7. Something is already running — don't interrupt it.
    //    - PENDING within the cooldown: a regeneration is in flight.
    //    - no status yet while still GENERATING_FEEDBACK: the INITIAL pipeline is
    //      still running (first-ever report), so there is nothing failed to redo.
    if (status === 'PENDING') {
      if (session.feedbackJob?.status !== 'FAILED') {
        return success(IN_PROGRESS, 200);
      }
      // Stale PENDING → recover it. Pin the timestamp so concurrent recoveries
      // dedupe (rewriting PENDING over PENDING can't dedupe on status alone).
    } else if (status === undefined || status === null) {
      if (state === INTERVIEW_STATES.GENERATING_FEEDBACK && session.feedbackJob?.status !== 'FAILED') {
        return success(IN_PROGRESS, 200);
      }
      // TERMINATED with no report ever stored → regenerate.
    }
    // status === 'FAILED' → regenerate.

    await require('../../lib/paidWork').assertRuntimeEnabled('feedback');
    const quota = await require('../../lib/quota').reserveQuota(uid, 'feedback');
    if (!quota.allowed) return require('../../lib/response').tooManyRequests('Daily feedback retry limit reached','QUOTA_EXCEEDED');
    const claimed = await attempt.claim(session,{retryReportId:partial?.feedbackId});
    if (!claimed) return success(IN_PROGRESS, 200);
    // Publication is checkpointed with the claim; the scheduled dispatcher retries.
    return success({ status: 'PENDING', regenerated: true, attemptId: claimed.attemptId }, 202);

  } catch (error) {
    diagnostics.error('[RegenerateFeedback] Error:', error);
    if(error.code==='ACCOUNT_DELETING') return conflict(error.message,error.code);
    if(error.code==='SERVICE_PAUSED') return serviceUnavailable(error.message,error.code);
    return internalError(error.message);
  }
};
