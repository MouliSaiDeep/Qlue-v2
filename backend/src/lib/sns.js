/**
 * Application wrappers for AWS SNS operations.
 */
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Publishes a raw message payload to a specific SNS topic.
 */
async function publishMessage(topicArn, message, subject) {
  try {
    const params = {
      TopicArn: topicArn,
      Message: typeof message === 'string' ? message : JSON.stringify(message),
      Subject: subject
    };

    const command = new PublishCommand(params);
    const response = await snsClient.send(command);
    return { success: true, messageId: response.MessageId };
  } catch (error) {
    console.error(`Failed to publish message to topic ${topicArn}`, error);
    return { success: false, error };
  }
}

/**
 * Publishes a structured feedback trigger event to the Feedback Pipeline queue.
 */
async function publishFeedbackTrigger(sessionId, userId, moduleType, contextRef = null) {
  const topicArn = process.env.FEEDBACK_TOPIC_ARN;
  if (!topicArn) {
    throw new Error('FEEDBACK_TOPIC_ARN environment variable is missing.');
  }

  const payload = {
    sessionId,
    userId,
    moduleType,
    triggeredAt: Date.now(),
    contextRef
  };

  return await publishMessage(topicArn, payload, `FeedbackTrigger_${sessionId}`);
}

module.exports = {
  publishMessage,
  publishFeedbackTrigger
};
