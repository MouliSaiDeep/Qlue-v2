/**
 * Utility to push session state updates via WebSocket.
 */
const { postToConnection } = require('../../lib/websocket');
const { MESSAGE_TYPES } = require('../../lib/websocketMessages');

/**
 * Deprecated under strict half-duplex protocol.
 * State updates are no longer sent over WebSocket as separate messages.
 */
async function pushStateUpdate(connectionId, sessionId, previousState, currentState, turnIndex, questionText = null) {
  console.warn(`Deprecated pushStateUpdate called for session ${sessionId}. No message will be sent.`);
  return false;
}

module.exports = {
  pushStateUpdate
};
