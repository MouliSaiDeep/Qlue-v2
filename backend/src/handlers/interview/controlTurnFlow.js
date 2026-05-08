const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');

const VALID_TRANSITIONS = {
  INITIALIZING: ['AI_SPEAKING', 'TERMINATED', 'ERROR'],
  AI_SPEAKING: ['USER_RESPONDING', 'TERMINATED', 'ERROR'],
  USER_RESPONDING: ['PROCESSING_RESPONSE', 'TERMINATED', 'ERROR'],
  PROCESSING_RESPONSE: ['AI_SPEAKING', 'TERMINATED', 'ERROR'],
  SILENCE_DETECTED: ['AI_SPEAKING', 'TERMINATED', 'ERROR'],
  GENERATING_FEEDBACK: ['TERMINATED', 'ERROR'],
  TERMINATED: [],
  ERROR: ['TERMINATED']
};

function transitionState(currentState, newState) {
  const allowed = VALID_TRANSITIONS[currentState] || [];
  if (!allowed.includes(newState)) {
    throw new Error(`Invalid interview state transition: ${currentState} -> ${newState}`);
  }
  return newState;
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { sessionId, newState, metadata = {} } = body;

    if (!sessionId || !newState) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'sessionId and newState are required' })
      };
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Session not found' })
      };
    }

    const validatedState = transitionState(session.currentState, newState);
    await updateSessionState(sessionId, validatedState, null, metadata);

    return {
      statusCode: 200,
      body: JSON.stringify({
        sessionId,
        previousState: session.currentState,
        newState: validatedState
      })
    };

  } catch (error) {
    console.error('Control Turn Flow Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

module.exports = {
  INTERVIEW_STATES,
  VALID_TRANSITIONS,
  transitionState
};
