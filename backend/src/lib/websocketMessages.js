/**
 * Validation schemas and constants for Qlue WebSocket communication.
 */

const MESSAGE_TYPES = {
  SESSION_INIT: 'session_init',
  TURN_SUBMIT: 'turn_submit',
  SESSION_RECONNECT: 'session_reconnect',
  TERMINATE_SESSION: 'terminate_session',
  PING: 'ping',
  PONG: 'pong',
  TURN_COMPLETE: 'turn_complete',
  TURN_ERROR: 'turn_error',
  TERMINATION: 'termination',
  ERROR: 'error'
};

/**
 * Validates the incoming message structure.
 * Returns { valid: boolean, error?: string }
 */
function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be a JSON object' };
  }

  if (!message.type || !Object.values(MESSAGE_TYPES).includes(message.type)) {
    return { valid: false, error: `Invalid or missing message type: ${message.type}` };
  }

  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.SESSION_INIT:
      if (!payload?.sessionId) return { valid: false, error: 'session_init requires sessionId' };
      break;
    case MESSAGE_TYPES.TURN_SUBMIT:
      if (!payload?.sessionId) return { valid: false, error: 'turn_submit requires sessionId' };
      if ((payload?.text == null || payload.text === '') && payload?.isSilence !== true) {
        return { valid: false, error: 'turn_submit requires text or isSilence true' };
      }
      break;
    case MESSAGE_TYPES.SESSION_RECONNECT:
    case MESSAGE_TYPES.TERMINATE_SESSION:
      if (!payload?.sessionId) return { valid: false, error: `${type} requires sessionId` };
      break;
    case MESSAGE_TYPES.PING:
    case MESSAGE_TYPES.PONG:
      break;
    default:
      break;
  }

  return { valid: true };
}

module.exports = {
  MESSAGE_TYPES,
  validateMessage
};
