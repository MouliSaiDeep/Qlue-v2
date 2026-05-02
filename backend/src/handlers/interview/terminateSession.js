const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const FEEDBACK_TOPIC_ARN = process.env.FEEDBACK_TOPIC_ARN;

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { sessionId, reason = 'USER_INITIATED' } = body;

    if (!sessionId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'sessionId required' }) };
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
    }

    // Allow termination from any state except already terminated
    if (session.currentState === INTERVIEW_STATES.TERMINATED) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Already terminated' }) };
    }

    await updateSessionState(sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, null, {
      terminatedAt: Date.now(),
      terminationReason: reason
    });

    // Trigger feedback generation via SNS
    if (FEEDBACK_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: FEEDBACK_TOPIC_ARN,
        Message: JSON.stringify({
          sessionId,
          userId: session.userId,
          reason
        })
      }));
    }

    await updateSessionState(sessionId, INTERVIEW_STATES.TERMINATED);

    return {
      statusCode: 200,
      body: JSON.stringify({
        sessionId,
        state: INTERVIEW_STATES.TERMINATED,
        reason
      })
    };

  } catch (error) {
    console.error('Terminate Session Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
