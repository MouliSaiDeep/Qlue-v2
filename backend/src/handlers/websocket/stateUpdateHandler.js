/**
 * Utility to push session state updates via WebSocket.
 */
const { postToConnection } = require('../../lib/websocket');
const { MESSAGE_TYPES } = require('../../lib/websocketMessages');

/**
 * Pushes a session_state_update message to the client.
 * Uses consistent payload wrapping format: { type, payload: {...} }
 */
async function pushStateUpdate(connectionId, sessionId, previousState, currentState, turnIndex, questionText = null) {
  const message = {
    type: MESSAGE_TYPES.SESSION_STATE_UPDATE,
    payload: {
      sessionId,
      previousState,
      state: currentState,
      turnIndex,
      questionText,
      timestamp: Date.now(),
    }
  };

  console.debug(`Pushing state update to ${connectionId}: ${previousState} -> ${currentState}`);
  const success = await postToConnection(connectionId, message);
  
  if (success) {
    console.info(`Successfully pushed state update for session ${sessionId} to connection ${connectionId}`);
  } else {
    console.warn(`Failed to push state update for session ${sessionId} to connection ${connectionId}. Connection might be stale.`);
  }

  return success;
}

module.exports = {
  pushStateUpdate
};
