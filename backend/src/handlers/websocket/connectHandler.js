/**
 * WebSocket $connect route handler.
 */
const { verifyIdToken } = require('../../lib/firebase');
const { saveConnection, deactivateConnection, getActiveConnectionByUserId } = require('../../models/wsConnection');
const { postToConnection } = require('../../lib/websocket');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token;
  console.info(`[Connect] New connection attempt. ID: ${connectionId}, QueryParams:`, JSON.stringify(event.queryStringParameters));

  if (!token) {
    console.error(`[Connect] Missing authentication token for connectionId: ${connectionId}`);
    return { statusCode: 401, body: 'Missing authentication token' };
  }

  try {
    // 1. Verify JWT token
    const decodedToken = await verifyIdToken(token);
    const userId = decodedToken.uid || decodedToken.userId;

    // 2. Check for existing active connection
    const oldConnection = await getActiveConnectionByUserId(userId);
    if (oldConnection && oldConnection.connectionId !== connectionId) {
      console.info(`User ${userId} already has an active connection ${oldConnection.connectionId}. Deactivating old and notifying.`);
      
      // Notify old connection about the new one (reconnection)
      try {
        await postToConnection(oldConnection.connectionId, {
          type: 'error',
          payload: {
            errorCode: 'RECONNECTED_ELSEWHERE',
            message: 'You have been disconnected because a new connection was established on another device.',
            recoverable: false,
            suggestedAction: 'RECONNECT'
          }
        });
      } catch (notifyError) {
        console.warn('Failed to notify old connection:', notifyError);
      }

      // BUG-5 FIX: Use conditional write to prevent race condition
      // Only deactivate if it's still marked as active (prevent multiple concurrent deactivations)
      try {
        await deactivateConnection(oldConnection.connectionId, { 
          expectedIsActive: 'true' 
        });
      } catch (deactivateErr) {
        if (deactivateErr.name === 'ConditionalCheckFailedException') {
          console.info(`Old connection ${oldConnection.connectionId} was already deactivated by another request`);
        } else {
          console.warn('Failed to deactivate old connection:', deactivateErr);
        }
      }
    }

    // 3. Register new connection
    await saveConnection(connectionId, userId);

    console.info(`Successfully connected connectionId: ${connectionId} for userId: ${userId}`);
    return { statusCode: 200, body: 'Connected' };

  } catch (error) {
    console.error('Connection failed:', error);
    if (error.name === 'QlueError' || error.statusCode === 401) {
      return { statusCode: 401, body: 'Unauthorized: ' + error.message };
    }
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
