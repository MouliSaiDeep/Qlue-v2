/**
 * Lambda handler for storing feedback reports and triggering user notifications.
 */
const { createFeedbackReport } = require('../../models/feedback');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));
const NOTIFY_LAMBDA = process.env.SEND_NOTIFICATION_LAMBDA;
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

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

    // 2. Update session record with the final scores for dashboard reflection
    try {
      console.info(`Updating session ${sessionId} with final scores...`);
      const updateCmd = new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression: "SET accumulatedScores = :scores, overallScore = :overall, updatedAt = :now",
        ExpressionAttributeValues: {
          ":scores": event.dimensionScores || {},
          ":overall": overallScore,
          ":now": new Date().toISOString()
        }
      });
      await docClient.send(updateCmd);
      console.info(`Session ${sessionId} updated successfully.`);
    } catch (sessionErr) {
      console.error(`Failed to update session ${sessionId}:`, sessionErr);
      // Don't fail the whole request if only session update fails
    }

    // 3. Update user stats in Users table
    // [DEFERRED] Skip update for now as user.js/models/user.js is a placeholder.

    // Update the Session with accumulatedScores so Dashboard and History APIs see it
    if (event.dimensionScores) {
      console.info(`Updating session ${sessionId} with accumulatedScores...`);
      const updateCmd = new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression: "SET accumulatedScores = :as",
        ExpressionAttributeValues: {
          ":as": event.dimensionScores
        }
      });
      await docClient.send(updateCmd);
      console.info(`Session ${sessionId} updated successfully.`);
    }

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
