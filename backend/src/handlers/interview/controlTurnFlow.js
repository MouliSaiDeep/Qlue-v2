const { INTERVIEW_STATES, updateSessionState, getSession } = require('../../models/session');

// Deterministic half-duplex state machine definition
const VALID_TRANSITIONS = {
    [INTERVIEW_STATES.INITIALIZING]: [INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.ERROR],
    [INTERVIEW_STATES.AI_SPEAKING]: [INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.ERROR],
    [INTERVIEW_STATES.USER_RESPONDING]: [INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.ERROR],
    [INTERVIEW_STATES.PROCESSING_RESPONSE]: [INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.SILENCE_DETECTED, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.ERROR],
    [INTERVIEW_STATES.SILENCE_DETECTED]: [INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.ERROR],
    [INTERVIEW_STATES.GENERATING_FEEDBACK]: [INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.ERROR],
    [INTERVIEW_STATES.TERMINATED]: [],
    [INTERVIEW_STATES.ERROR]: []
};

/**
 * Checks if a state transition is legal according to the deterministic matrix
 */
function validateTransition(currentState, targetState) {
    if (!VALID_TRANSITIONS[currentState]) return false;
    return VALID_TRANSITIONS[currentState].includes(targetState);
}

/**
 * Executes a state transition, locking in DynamoDB to prevent race conditions.
 */
async function transitionState(sessionId, targetState, updates = {}) {
    const session = await getSession(sessionId);
    if (!session) throw new Error('Session not found mapping to ID ' + sessionId);
    
    const currentState = session.currentState;

    if (!validateTransition(currentState, targetState)) {
        throw new Error(`Invalid interview state transition: ${currentState} -> ${targetState}`);
    }

    return await updateSessionState(sessionId, targetState, currentState, {
        ...updates,
        expectedVersion: session.version
    });
}

module.exports = {
    INTERVIEW_STATES,
    validateTransition,
    transitionState
};
