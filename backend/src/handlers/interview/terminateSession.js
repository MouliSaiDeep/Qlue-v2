const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { getLatestTranscripts } = require('../../models/transcript');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

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

    // BE-BUG #14 FIX: Verify session ownership before allowing termination
    const userId = event.requestContext?.authorizer?.uid;
    if (userId && session.userId !== userId) {
      console.warn(`[TerminateSession] Ownership violation: user ${userId} attempted to terminate session owned by ${session.userId}`);
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden: You do not own this session' }) };
    }

    // Allow termination from any state except already terminated
    if (session.currentState === INTERVIEW_STATES.TERMINATED) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Already terminated' }) };
    }

    // DISCARD FIX: if the candidate never actually answered anything (e.g.
    // opened a session by accident and ended it immediately), there is
    // nothing to score. Generating feedback from an empty transcript produced
    // hallucinated scores (users saw 80/100 for saying nothing). Such
    // sessions are terminated as discarded: no feedback pipeline, excluded
    // from dashboard stats and history.
    let hasUserAnswer = false;
    try {
      const recent = await getLatestTranscripts(sessionId, 20);
      hasUserAnswer = recent.some(t =>
        t.speaker === 'USER' && typeof t.text === 'string' && t.text.trim().length > 0
      );
    } catch (txErr) {
      console.warn('[TerminateSession] Transcript check failed; assuming answerable session:', txErr.message);
      hasUserAnswer = true;
    }

    if (!hasUserAnswer) {
      console.log(`[TerminateSession] Session ${sessionId} has no user answers; discarding.`);
      await updateSessionState(sessionId, INTERVIEW_STATES.TERMINATED, null, {
        terminatedAt: Date.now(),
        terminationReason: 'DISCARDED_EMPTY',
        discarded: true
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          sessionId,
          state: INTERVIEW_STATES.TERMINATED,
          reason: 'DISCARDED_EMPTY',
          discarded: true
        })
      };
    }

    await updateSessionState(sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, null, {
      terminatedAt: Date.now(),
      terminationReason: reason
    });

    // Trigger feedback generation via SNS.
    // Read the env var lazily so runtime configuration (and tests) that set it
    // after module load are honoured.
    const FEEDBACK_TOPIC_ARN = process.env.FEEDBACK_TOPIC_ARN;
    if (FEEDBACK_TOPIC_ARN) {
      await snsClient.send(new PublishCommand({
        TopicArn: FEEDBACK_TOPIC_ARN,
        Message: JSON.stringify({
          sessionId,
          userId: session.userId,
          moduleType: session.moduleType,
          reason
        })
      }));
    }

    try {
      await updateSessionState(sessionId, INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK);
    } catch (stateErr) {
      if (stateErr.name === 'ConditionalCheckFailedException') {
        console.warn(`[TerminateSession] Session ${sessionId} changed state before terminate: ${stateErr.message}`);
      } else {
        throw stateErr;
      }
    }

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
