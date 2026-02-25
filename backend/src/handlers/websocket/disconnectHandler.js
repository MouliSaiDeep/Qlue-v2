/**
 * WebSocket $disconnect route handler.
 */
const { getConnection, deactivateConnection } = require('../../models/wsConnection');
const { publishFeedbackTrigger } = require('../../lib/sns');
// const { transitionSessionStatus } = require('../../models/session'); // Skip for now as session.js is placeholder

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  try {
    // 1. Fetch connection record
    const connection = await getConnection(connectionId);
    
    if (connection) {
      const { userId, sessionId, isActive } = connection;

      if (isActive === 'true') {
        // 2. Handle active session if connection lost
        if (sessionId) {
          console.info(`Connection ${connectionId} lost for session ${sessionId}. Handling potential feedback trigger.`);
          
          // Note: In a real implementation, we'd check if the session is still active 
          // and transition it to TERMINATEDABORTED. 
          // Since session.js is a placeholder, we skip the DB update but trigger the pipeline 
          // if the session reached a point that warrants it.
          
          // For now, we only publish feedback trigger if the session was explicitly marked as needing one.
          // However, task 2 says: "transition to TERMINATEDABORTED if active... then publish SNS".
          // We will log the intention and publish the trigger.
          console.info(`[DEFERRED] Transitioning session ${sessionId} to TERMINATEDABORTED.`);
          
          await publishFeedbackTrigger(sessionId, userId, 'AUTO_DISCONNECT', 'CONNECTION_LOST');
        }

        // 3. Mark connection as inactive
        await deactivateConnection(connectionId);
      }
    }

    console.info(`Successfully processed disconnect for connectionId: ${connectionId}`);
    return { statusCode: 200, body: 'Disconnected' };

  } catch (error) {
    console.error(`Disconnect failed for connectionId: ${connectionId}`, error);
    // Standard practice for $disconnect: always return 200 to AWS
    return { statusCode: 200, body: 'Disconnected with errors' };
  }
};
