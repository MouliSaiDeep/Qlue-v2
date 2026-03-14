/**
 * Lambda handler for storing feedback reports and triggering user notifications.
 */
const { createFeedbackReport } = require('../../models/feedback');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const NOTIFY_LAMBDA = process.env.SEND_NOTIFICATION_LAMBDA;

exports.handler = async (event) => {
  const { userId, sessionId, overallScore, moduleType } = event;

  try {
    console.info(`Storing feedback report for user ${userId}, session ${sessionId}`);

    // 1. Store the feedback report in DynamoDB
    const result = await createFeedbackReport(event);
    
    if (!result.success) {
      throw new Error(`Failed to store feedback in DynamoDB: ${result.error?.message}`);
    }

    const { feedbackId } = result;
    console.info(`Feedback report stored with ID: ${feedbackId}`);

    // 2. Update user stats in Users table
    // [DEFERRED] Skip update for now as user.js/models/user.js is a placeholder.
    // In production, this would be a TransactWrite to increment sessions and update avgScore.
    console.info(`[DEFERRED] Updating user stats for userId: ${userId}`);

    // 3. Trigger notification asynchronously
    const notificationPayload = {
      userId,
      sessionId,
      feedbackId,
      overallScore,
      moduleType
    };

    console.info(`Triggering completion notification for user ${userId}`);
    
    const command = new InvokeCommand({
      FunctionName: NOTIFY_LAMBDA,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(notificationPayload))
    });

    await lambdaClient.send(command);

    return { success: true, feedbackId };

  } catch (error) {
    console.error(`Feedback storage failed for session ${sessionId}:`, error);
    throw error;
  }
};
