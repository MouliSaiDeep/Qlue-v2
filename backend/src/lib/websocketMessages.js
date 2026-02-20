/**
 * Validation schemas and constants for Qlue WebSocket communication.
 */

const MESSAGE_TYPES = {
  SESSION_INIT: 'session_init',
  TEXT_TRANSCRIPT: 'text_transcript',
  HEARTBEAT: 'heartbeat',
  SESSION_RESUME: 'session_resume',
  SESSION_STATE_UPDATE: 'session_state_update',
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
    case MESSAGE_TYPES.TEXT_TRANSCRIPT:
      if (!payload?.sessionId || !payload?.text) {
        return { valid: false, error: 'text_transcript requires sessionId and text' };
      }
      break;
    case MESSAGE_TYPES.SESSION_RESUME:
      if (!payload?.sessionId) return { valid: false, error: 'session_resume requires sessionId' };
      break;
    case MESSAGE_TYPES.HEARTBEAT:
      // Heartbeat might not have a payload
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
