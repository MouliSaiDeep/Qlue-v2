const diagnostics=require('../lib/logger').safeConsole;
/**
 * Model for managing Feedback records in DynamoDB.
 */
const ddb = require('../lib/dynamodb');

const TABLE_NAME = process.env.FEEDBACK_TABLE || 'qlue-feedback'; // BE-BUG #23 FIX: was 'Feedback'

/**
 * Creates and stores a feedback report.
 *
 * Finding 9: the async feedback pipeline is invoked at-least-once (SNS + async
 * Lambda + retries + DLQ replay), so a retry must NOT create a second report.
 * The report identity is deterministic (sessionId + report version) and the
 * write is conditional on that id not already existing, making the create
 * idempotent: a duplicate delivery that finds the report already present is
 * reported as success, not a second row.
 */
async function createFeedbackReport(data) {
  const reportVersion = data.reportVersion || 'v1';
  const feedbackId = data.feedbackId || `${data.sessionId}#${data.attemptId || reportVersion}`;
  const item = {
    ...data,
    feedbackId,
    reportVersion,
    status: data.status || 'COMPLETE',
    notificationStatus: data.analysisStatus === 'UNAVAILABLE' ? 'SKIPPED' : 'PENDING',
    notificationAttempts: 0,
    generatedAt: Date.now()
  };

  const parent = { TableName:process.env.SESSIONS_TABLE||'qlue-sessions',Key:{sessionId:data.sessionId},
    ConditionExpression:'attribute_exists(sessionId)', ...(data.attemptId ? {
      ConditionExpression:'attribute_exists(sessionId) AND feedbackAttemptId = :attempt',ExpressionAttributeValues:{':attempt':data.attemptId}
    } : {ConditionExpression:'attribute_exists(sessionId) AND attribute_not_exists(feedbackAttemptId)'}) };
  const result = await ddb.put(TABLE_NAME, item, { condition: 'attribute_not_exists(feedbackId)', parentChecks:[{ConditionCheck:parent}] });
  if (result.success) {
    return { success: true, feedbackId, data: item };
  }
  if (result.error?.name === 'ConditionalCheckFailedException') {
    // A prior successful attempt already wrote this exact report — the retry is
    // a no-op, not a failure, and must not fan out a second notification.
    // R-06: return the PERSISTED canonical report so the caller derives the
    // session's feedbackStatus/scores from what is actually stored, never from
    // the discarded duplicate payload (a late failed retry must not downgrade a
    // stored COMPLETE report, and vice-versa).
    diagnostics.info(`Feedback report ${feedbackId} already exists; treating retry as idempotent success.`);
    const existing = await getFeedbackById(feedbackId);
    if (!existing) return result;
    return { success: true, feedbackId, duplicate: true, data: existing };
  }
  return result;
}

/**
 * Deletes a feedback report by id.
 *
 * R-06: regeneration clears the stale (FAILED/UNAVAILABLE) report slot before
 * re-publishing the pipeline, so the deterministic create-only write can store a
 * fresh report in the same `sessionId#version` slot instead of being rejected as
 * a duplicate. Returns the `{ success, error }` contract from the ddb wrapper.
 */
async function deleteFeedbackReport(feedbackId) {
  return ddb.delete(TABLE_NAME, { feedbackId });
}

/**
 * Retrieves feedback by ID.
 */
async function getFeedbackById(feedbackId) {
  const result = await ddb.get(TABLE_NAME, { feedbackId },{consistentRead:true});
  return result.success ? result.data : null;
}

/**
 * Retrieves latest feedback for a user.
 */
async function getLatestFeedbackForUser(userId) {
  const result = await ddb.query(
    TABLE_NAME,
    'userId = :uid',
    {
      values: { ':uid': userId },
      index: 'GSI_UserIdGeneratedAt',
      limit: 1,
      scanIndexForward: false // Latest first
    }
  );

  if (result.success && result.data && result.data.length > 0) {
    return result.data[0];
  }
  return null;
}

module.exports = {
  createFeedbackReport,
  deleteFeedbackReport,
  getFeedbackById,
  getLatestFeedbackForUser
};
