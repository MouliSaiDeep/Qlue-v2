const diagnostics=require('../../lib/logger').safeConsole;
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { getTranscriptBySession } = require('../../models/transcript');
const {isClarification, detectExitIntent} = require('./processUserInput');
const {
  FEEDBACK_JOB,
  DISPATCH_MARKER,
  buildFeedbackPayload,
  publishFeedbackJob,
  clampError
} = require('../../lib/feedbackDispatch');

// R-05: finalize a session whose feedback job has been published. The
// TERMINATED transition removes the sparse dispatch marker (terminal cleanup in
// updateSessionState), so a dispatched job leaves the dispatcher's index. A
// concurrent terminate that already advanced the row loses this conditional
// write — that is fine, the work is done.
async function finalizeTerminated(sessionId,attemptId) {
  try {
    await updateSessionState(sessionId, INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK,{expectedFeedbackAttemptId:attemptId});
  } catch (stateErr) {
    if (stateErr.name !== 'ConditionalCheckFailedException') throw stateErr;
    diagnostics.warn(`[TerminateSession] Session ${sessionId} changed state before terminate: ${stateErr.name}`);
  }
}

// R-05: keep the outbox job PENDING (and in the dispatch index) after a failed
// publish, recording the attempt count and last error. Conditional on the row
// still being in GENERATING_FEEDBACK so a terminate that already finalized the
// session is never reopened.
async function markJobPending(sessionId, payload, attempts, lastError) {
  try {
    await updateSessionState(sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.GENERATING_FEEDBACK, {
      feedbackJob: { status: FEEDBACK_JOB.PENDING, attempts, payload, lastError: clampError(lastError) },
      expectedFeedbackAttemptId:payload.attemptId,
      feedbackDispatchPending: DISPATCH_MARKER
    });
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
  }
}

// R-05: publish a job and finalize on success; on failure leave it PENDING for
// retry. NEVER throws past here — a publish failure must not 500 the terminate
// (a 500 + the GENERATING_FEEDBACK guard is exactly what silently dropped
// feedback before). Returns the HTTP response body fields.
async function dispatchOrDefer(sessionId, payload, priorAttempts) {
  let result;
  try {
    result = await publishFeedbackJob(payload);
    if(!result.published) throw new Error('Feedback topic is unavailable');
  } catch (pubErr) {
    const attempts = priorAttempts + 1;
    diagnostics.error(`[TerminateSession] Feedback publish failed for ${sessionId} (attempt ${attempts}); job left PENDING for retry:`, pubErr.name);
    await markJobPending(sessionId, payload, attempts, pubErr.message);
    return { state: INTERVIEW_STATES.GENERATING_FEEDBACK, feedbackPending: true };
  }
  // Published, or no topic is configured (nothing to retry) — finalize either way.
  await finalizeTerminated(sessionId,payload.attemptId);
  return { state: INTERVIEW_STATES.TERMINATED, published: !!result.published };
}

function terminationOutcome(session) {
  return {
    sessionId:session.sessionId, state:session.currentState,
    reason:session.terminationReason || session.currentState,
    feedbackExpected:session.feedbackExpected ?? !session.discarded,
    ...(session.discarded ? {discarded:true} : {})
  };
}

async function terminate(event, rechecks = 0) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { sessionId, reason: requestedReason = 'USER_INITIATED' } = body;

    if (!sessionId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'sessionId required' }) };
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
    }
    const reason = session.terminationReason || requestedReason;

    // BE-BUG #14 FIX: Verify session ownership before allowing termination.
    // The guard used to be `if (userId && ...)`, which silently skipped the
    // check whenever the caller omitted the identity. Every caller (REST
    // authorizer, sendTextHandler, asyncWorker, initializeSession) supplies it,
    // so a missing uid is a bug, not an internal-caller shortcut.
    const userId = event.requestContext?.authorizer?.uid;
    if (!userId) {
      diagnostics.error('[TerminateSession] Missing user context');
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: missing user context' }) };
    }
    if (session.userId !== userId) {
      diagnostics.warn(`[TerminateSession] Ownership violation: user ${userId} attempted to terminate session owned by ${session.userId}`);
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: You do not own this session' }) };
    }

    // Allow termination from any state except already terminated
    if (session.currentState === INTERVIEW_STATES.TERMINATED) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Already terminated', ...terminationOutcome(session) }) };
    }

    // Finding 5 (point 7) + R-05: the app fires BOTH a WebSocket terminate_session
    // and a REST terminate on end, and generateAtomicTurn can auto-terminate too,
    // so several termination paths race. If the session has already entered the
    // feedback pipeline, this call is idempotent — EXCEPT when the outbox job is
    // still PENDING: that means a prior publish failed (or its process died)
    // before the feedback job was ever dispatched. The old code returned success
    // here unconditionally, so that lost feedback forever. Now a PENDING job is
    // RE-DISPATCHED by this racing duplicate terminate (the common recovery path,
    // since WS+REST both fire), with the scheduled dispatcher as the backstop.
    if (session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
      if (session.feedbackJob?.status === FEEDBACK_JOB.PENDING) {
        // A fresh outbox's first publish may still be in flight. The scheduled
        // dispatcher recovers a crash; a duplicate End must not publish twice.
        if (!session.feedbackJob.attempts) {
          return {statusCode:200,body:JSON.stringify({...terminationOutcome(session),feedbackPending:true})};
        }
        const payload = session.feedbackJob.payload || buildFeedbackPayload(session, reason);
        const body = await dispatchOrDefer(sessionId, payload, session.feedbackJob.attempts || 0);
        return { statusCode: 200, body: JSON.stringify({ ...terminationOutcome(session), recovered: true, ...body }) };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          ...terminationOutcome(session),
          state: INTERVIEW_STATES.GENERATING_FEEDBACK,
          message: 'Feedback already in progress'
        })
      };
    }

    // DISCARD FIX: if the candidate never actually answered anything (e.g.
    // opened a session by accident and ended it immediately), there is
    // nothing to score. Generating feedback from an empty transcript produced
    // hallucinated scores (users saw 80/100 for saying nothing). Such
    // sessions are terminated as ungraded: no feedback pipeline and excluded
    // from dashboard stats/history. Owned detail remains available for recovery.
    //
    // I-08: trust the DURABLE, strongly-consistent `answeredCount` on the session
    // row (stamped by processUserInput the instant a real answer is accepted)
    // rather than the eventually-consistent transcripts GSI. The app fires BOTH a
    // WebSocket and a REST terminate on end, so a freshly-answered session was
    // being read back with an empty GSI and WRONGLY discarded, losing the whole
    // interview. New sessions start at zero. Missing counts remain legacy:
    // examine the full retained transcript, excluding known controls/rejected
    // events, instead of truncating away an old real answer. Ambiguous historical
    // single-word answers remain eligible; no historical records are rewritten.
    let hasUserAnswer = false;
    if (typeof session.answeredCount === 'number') {
      hasUserAnswer = session.answeredCount > 0;
    } else {
      try {
        const recent = await getTranscriptBySession(sessionId);
        hasUserAnswer = recent.some(t =>
          t.speaker === 'USER' && typeof t.text === 'string' && t.text.trim().length > 0
          && !isClarification(t.text) && !detectExitIntent(t.text)
          && !(session.fragmentIds || []).includes(t.eventId)
          && !(['INTRO','SELF_INTRO'].includes(session.moduleType) && /^(?:hello|hi|hey)[.!?\s]*$/i.test(t.text.trim()))
        );
      } catch (txErr) {
        diagnostics.warn('[TerminateSession] Transcript check failed; assuming answerable session:', txErr.name);
        hasUserAnswer = true;
      }
    }

    if (!hasUserAnswer) {
      diagnostics.log(`[TerminateSession] Session ${sessionId} has no user answers; discarding.`);
      try {
        await updateSessionState(sessionId, INTERVIEW_STATES.TERMINATED, session.currentState, {
          ...(session.version !== undefined ? {expectedVersion:session.version} : {}),
          terminatedAt: Date.now(),
          terminationReason: reason,
          feedbackExpected: false,
          ...(process.env.ANSWER_AUDIO_BUCKET ? {answerAudioClosed:true,answerAudioCleanupPending:true} : {}),
          discarded: true
        });
      } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
        // An answer or another termination won; decide from its durable state.
        if (rechecks < 2) return terminate(event,rechecks+1);
        return {statusCode:409,body:JSON.stringify({error:'Session changed; retry termination'})};
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          sessionId,
          state: INTERVIEW_STATES.TERMINATED,
          reason,
          feedbackExpected: false,
          discarded: true
        })
      };
    }

    // Finding 5 (point 7) + R-05: atomically claim the feedback pipeline from the
    // exact state we observed AND write the feedback OUTBOX entry in the same
    // conditional item write (a single-item DynamoDB update is inherently
    // atomic). A concurrent terminate that already advanced the session loses
    // this conditional write, so only one caller claims the job. Persisting the
    // PENDING job + sparse dispatch marker BEFORE attempting SNS is what makes a
    // failed publish recoverable instead of silently lost.
    const payload = buildFeedbackPayload(session, reason);
    try {
      await updateSessionState(sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, session.currentState, {
        terminatedAt: Date.now(),
        terminationReason: reason,
        feedbackExpected: true,
        ...(session.version !== undefined ? {expectedVersion:session.version} : {}),
        feedbackStatus: 'PENDING',
        feedbackAttemptId: payload.attemptId,
        feedbackAttemptStartedAt: Date.now(),
        feedbackJob: { status: FEEDBACK_JOB.PENDING, attempts: 0, payload },
        feedbackDispatchPending: DISPATCH_MARKER
      });
    } catch (claimErr) {
      if (claimErr.name === 'ConditionalCheckFailedException') {
        diagnostics.warn(`[TerminateSession] Session ${sessionId} advanced past ${session.currentState} before feedback claim; skipping duplicate pipeline.`);
        const latest = await getSessionById(sessionId);
        if (latest && ![INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK].includes(latest.currentState)) {
          if (rechecks < 2) return terminate(event,rechecks+1);
          return {statusCode:409,body:JSON.stringify({error:'Session changed; retry termination'})};
        }
        return {
          statusCode: 200,
          body: JSON.stringify({
            ...terminationOutcome(latest || session),
            message: 'Termination already in progress'
          })
        };
      }
      throw claimErr;
    }

    // Dispatch the feedback job. On success the session is finalized to
    // TERMINATED (dropping it from the dispatch index); on failure the job stays
    // PENDING and is retried by the racing duplicate terminate or the scheduled
    // dispatcher — the terminate still returns 200 so the client is not blocked.
    const dispatchBody = await dispatchOrDefer(sessionId, payload, 0);

    return {
      statusCode: 200,
      body: JSON.stringify({
        sessionId,
        reason,
        feedbackExpected: true,
        ...dispatchBody
      })
    };

  } catch (error) {
    diagnostics.error('Terminate Session Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
exports.handler = event => terminate(event);
exports.terminationOutcome = terminationOutcome;
