/**
 * Interview turn state machine — shared helpers only.
 *
 * This module previously also exported a Lambda `handler` for a public
 * `/interview/flow` route, but the trailing `module.exports = {...}` clobbered
 * that export, so the route was dead (its handler resolved to undefined). The
 * route and its function have been removed from template.yaml; leaving an
 * unguarded session-mutation endpoint enabled would have been worse than
 * removing it. Only the pure transition helpers remain, consumed by
 * services/interviewService.js and the interview workers.
 */
const { INTERVIEW_STATES } = require('../../models/session');

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

module.exports = {
  INTERVIEW_STATES,
  VALID_TRANSITIONS,
  transitionState
};
