const diagnostics=require('../../lib/logger').safeConsole;
/**
 * Utility to push error messages via WebSocket.
 */
const { postToConnection } = require('../../lib/websocket');
const { MESSAGE_TYPES } = require('../../lib/websocketMessages');

/**
 * Pushes an error message to the client.
 */
async function pushError(connectionId, errorCode, message, recoverable, suggestedAction) {
  const errorPayload = {
    type: MESSAGE_TYPES.ERROR,
    timestamp: Date.now(),
    payload: {
      errorCode,
      message,
      recoverable,
      suggestedAction
    }
  };

  diagnostics.error(`Pushing error to ${connectionId}: [${errorCode}]`);
  const success = await postToConnection(connectionId, errorPayload);
  
  if (!success) {
    diagnostics.warn(`Failed to push error to ${connectionId}. Connection might be stale.`);
  }

  return success;
}

module.exports = {
  pushError
};
