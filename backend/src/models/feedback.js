/**
 * Model for managing Feedback records in DynamoDB.
 */
const ddb = require('../lib/dynamodb');
const { v4: uuidv4 } = require('uuid');

const TABLE_NAME = process.env.FEEDBACK_TABLE || 'Feedback';

/**
 * Creates and stores a new feedback report.
 */
async function createFeedbackReport(data) {
  const feedbackId = uuidv4();
  const item = {
    feedbackId,
    ...data,
    generatedAt: Date.now()
  };

  const result = await ddb.put(TABLE_NAME, item);
  if (result.success) {
    return { success: true, feedbackId, data: item };
  }
  return result;
}

/**
 * Retrieves feedback by ID.
 */
async function getFeedbackById(feedbackId) {
  const result = await ddb.get(TABLE_NAME, { feedbackId });
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
  getFeedbackById,
  getLatestFeedbackForUser
};
