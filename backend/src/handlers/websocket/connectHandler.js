/**
 * WebSocket $connect route handler.
 */
const { verifyIdToken } = require('../../lib/firebase');
const { saveConnection, deactivateConnection, getActiveConnectionByUserId } = require('../../models/wsConnection');
const { postToConnection } = require('../../lib/websocket');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token;

  if (!token) {
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
      await postToConnection(oldConnection.connectionId, {
        type: 'error',
        payload: {
          errorCode: 'RECONNECTED_ELSEWHERE',
          message: 'You have been disconnected because a new connection was established on another device.',
          recoverable: false,
          suggestedAction: 'RECONNECT'
        }
      });

      // Deactivate old connection
      await deactivateConnection(oldConnection.connectionId);
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
