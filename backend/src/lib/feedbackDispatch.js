/**
 * R-05: feedback-dispatch outbox helpers.
 *
 * Feedback used to be lost when a session entered GENERATING_FEEDBACK but its
 * SNS publish failed (or the Lambda died right after the state transition): the
 * session was wedged in GENERATING_FEEDBACK and every retry hit the
 * "already in progress" guard and returned success WITHOUT ever publishing, so
 * no report and no notification were ever produced.
 *
 * The fix is a durable outbox: a feedback job is persisted ATOMICALLY with the
 * GENERATING_FEEDBACK transition (a single conditional item write on the session
 * row, inherently atomic), carrying its own status + payload + a sparse dispatch
 * marker. Publication is then retried — by the racing duplicate terminate, and
 * by a scheduled dispatcher — until acknowledged. Downstream stages are
 * idempotent (createFeedbackReport is a conditional write), so a duplicate
 * publish is harmless.
 */
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Lifecycle of a feedback outbox job.
const FEEDBACK_JOB = {
  PENDING: 'PENDING',       // claimed, publish not yet acknowledged
  DISPATCHED: 'DISPATCHED', // SNS accepted the publish
  FAILED: 'FAILED'          // gave up after MAX_DISPATCH_ATTEMPTS (ops-visible)
};

// Value of the sparse `feedbackDispatchPending` GSI partition key. The attribute
// exists ONLY while a job is PENDING; finalizing a session (TERMINATED/ERROR) or
// parking a job FAILED removes it, so the FeedbackDispatchIndex only ever holds
// genuinely-pending jobs and the dispatcher never scans.
const DISPATCH_MARKER = 'PENDING';

// Cap re-publish attempts so a permanently-failing job is parked (FAILED) and
// surfaced to ops instead of spinning forever.
const MAX_DISPATCH_ATTEMPTS = 5;

// Keep persisted error strings short — they are diagnostics, never user content.
const MAX_ERROR_LEN = 300;

function clampError(message) {
  return String(message || '').slice(0, MAX_ERROR_LEN);
}

/**
 * The minimal, deterministic payload the feedback pipeline consumes. Built from
 * the session so a recovered/dispatched job carries the same message whether it
 * is published by terminateSession or by the scheduled dispatcher.
 */
function buildFeedbackPayload(session, reason) {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    moduleType: session.moduleType,
    attemptId: session.feedbackAttemptId || `initial-${session.sessionId}`,
    reason: reason || session.terminationReason || 'RECOVERED'
  };
}

/**
 * Publish a feedback job to SNS.
 *  - returns { published: true }                       on success
 *  - returns { published: false, reason: 'NO_TOPIC' }  when no topic is wired
 *    (local/dev/test) — nothing to retry, caller finalizes
 *  - THROWS on a real publish error so the caller KEEPS the outbox PENDING and
 *    lets the dispatcher / duplicate terminate retry it.
 *
 * The topic ARN is read lazily so runtime config (and tests) that set it after
 * module load are honoured.
 */
async function publishFeedbackJob(payload) {
  const arn = process.env.FEEDBACK_TOPIC_ARN;
  if (!arn) throw new Error('Feedback topic is unavailable');
  await require('./deadline').sendBounded(snsClient,new PublishCommand({
    TopicArn: arn,
    Message: JSON.stringify(payload)
  }));
  return { published: true };
}

module.exports = {
  FEEDBACK_JOB,
  DISPATCH_MARKER,
  MAX_DISPATCH_ATTEMPTS,
  buildFeedbackPayload,
  publishFeedbackJob,
  clampError
};
