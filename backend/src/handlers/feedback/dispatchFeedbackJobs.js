const diagnostics=require('../../lib/logger').safeConsole;
/**
 * R-05 backstop: scheduled dispatcher for the feedback outbox.
 *
 * The PRIMARY recovery path is a racing duplicate terminate (the app fires both
 * a WebSocket `terminate_session` and a REST terminate on end), which re-dispatches
 * a still-PENDING job. This Lambda is the BACKSTOP for the case where every
 * terminate path died before the publish was acknowledged (e.g. the process was
 * killed right after the atomic GENERATING_FEEDBACK claim): nothing else will
 * ever retry such a job, so a scheduled sweep must.
 *
 * It QUERIES the sparse `FeedbackDispatchIndex` (never scans) for jobs whose
 * marker has sat past a grace period — the grace window keeps the dispatcher
 * from racing the primary path for a freshly-claimed job. For each candidate it
 * re-reads the session with a CONSISTENT read (the index is eventually
 * consistent) and, only if the job is still GENERATING_FEEDBACK + PENDING,
 * publishes it:
 *   - success                      -> finalize TERMINATED (removes the marker)
 *   - failure, attempts <  MAX      -> keep PENDING, bump attempts (advances the
 *                                      index sort key so it isn't re-picked at once)
 *   - failure, attempts >= MAX      -> park FAILED + remove the marker (ops-visible,
 *                                      leaves the index so the sweep stays cheap)
 * Downstream feedback stages are idempotent, so a duplicate publish is harmless.
 */
const { updateSessionState, getSession, INTERVIEW_STATES } = require('../../models/session');
const ddb = require('../../lib/dynamodb');
const {
  FEEDBACK_JOB,
  DISPATCH_MARKER,
  MAX_DISPATCH_ATTEMPTS,
  buildFeedbackPayload,
  publishFeedbackJob,
  clampError
} = require('../../lib/feedbackDispatch');

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';
const DISPATCH_INDEX = 'FeedbackDispatchIndex';
// Only sweep jobs older than this, so the dispatcher never races the primary
// (duplicate-terminate) path for a job that was claimed moments ago.
const DISPATCH_GRACE_MS = parseInt(process.env.FEEDBACK_DISPATCH_GRACE_MS || '60000', 10);
// Bound the work per invocation; the schedule picks up the remainder next tick.
const MAX_PER_RUN = parseInt(process.env.FEEDBACK_DISPATCH_MAX_PER_RUN || '100', 10);

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
  if (!session || session.currentState !== INTERVIEW_STATES.GENERATING_FEEDBACK) {
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
      // No topic wired (shouldn't happen in the scheduled env) — nothing to
      // retry against; finalize so the job doesn't spin forever.
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

exports.handler = async () => {
  const cutoff = Date.now() - DISPATCH_GRACE_MS;
  const summary = { scanned: 0, dispatched: 0, deferred: 0, failed: 0, skipped: 0 };

  let exclusiveStartKey;
  do {
    const page = await ddb.query(
      SESSIONS_TABLE,
      'feedbackDispatchPending = :p AND feedbackJobUpdatedAt < :cutoff',
      {
        index: DISPATCH_INDEX,
        values: { ':p': DISPATCH_MARKER, ':cutoff': cutoff },
        scanIndexForward: true, // oldest-pending first
        exclusiveStartKey
      }
    );

    if (!page.success) {
      // A failed index read is transient — throw so the schedule retries. We have
      // not acknowledged any job, so nothing is lost.
      throw new Error(`FeedbackDispatchIndex query failed: ${page.error?.message || 'unknown error'}`);
    }

    for (const candidate of page.data || []) {
      if (summary.scanned >= MAX_PER_RUN) break;
      summary.scanned++;
      await dispatchOne(candidate, summary);
    }

    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey && summary.scanned < MAX_PER_RUN);

  diagnostics.info('[DispatchFeedback] sweep complete', summary);
  return summary;
};
