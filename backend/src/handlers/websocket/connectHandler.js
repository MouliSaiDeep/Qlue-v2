const diagnostics=require('../../lib/logger').safeConsole;
/**
 * WebSocket $connect route handler.
 */
const { verifyIdToken } = require('../../lib/firebase');
const { saveConnection, deactivateConnection, getActiveConnectionByUserId } = require('../../models/wsConnection');
const { postToConnection } = require('../../lib/websocket');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token;
  // SECURITY: never log queryStringParameters verbatim — it carries the
  // Firebase ID token, which would then sit in CloudWatch in plaintext for
  // anyone with log read access to replay until it expires.
  diagnostics.info(`[Connect] New connection attempt. ID: ${connectionId}, tokenPresent: ${Boolean(token)}`);

  if (!token) {
    diagnostics.error(`[Connect] Missing authentication token for connectionId: ${connectionId}`);
    return { statusCode: 401, body: 'Missing authentication token' };
  }

  try {
    // 1. Verify JWT token, rejecting revoked/disabled credentials at connect
    // time (checkRevoked=true). Without this, a token revoked by sign-out,
    // password reset or account deletion could still open a socket that then
    // stays valid for the whole ttl window (finding 16).
    const decodedToken = await verifyIdToken(token, true);
    const userId = decodedToken.uid || decodedToken.userId;
    if (decodedToken.email_verified !== true) {
      return { statusCode: 403, body: 'EMAIL_VERIFICATION_REQUIRED' };
    }

    // 2. Check for existing active connection
    const oldConnection = await getActiveConnectionByUserId(userId);
    if (oldConnection && oldConnection.connectionId !== connectionId) {
      diagnostics.info(`User ${userId} already has an active connection ${oldConnection.connectionId}. Deactivating old and notifying.`);
      
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
        diagnostics.warn('Failed to notify old connection:', notifyError);
      }

      // BUG-5 FIX: Use conditional write to prevent race condition
      // Only deactivate if it's still marked as active (prevent multiple concurrent deactivations)
      try {
        await deactivateConnection(oldConnection.connectionId, { 
          expectedIsActive: 'true' 
        });
      } catch (deactivateErr) {
        if (deactivateErr.name === 'ConditionalCheckFailedException') {
          diagnostics.info(`Old connection ${oldConnection.connectionId} was already deactivated by another request`);
        } else {
          diagnostics.warn('Failed to deactivate old connection:', deactivateErr);
        }
      }
    }

    // 3. Register new connection. R-10: bind the connection's authorization
    // window to the verified token's own expiry so a socket can never outlive
    // the credential that opened it. A later session-level reconnect MESSAGE
    // must not extend this — only a fresh $connect (which re-verifies a token)
    // resets it.
    await saveConnection(connectionId, userId, null, { authExpiresAt: decodedToken.exp, emailVerified: true });

    diagnostics.info(`Successfully connected connectionId: ${connectionId} for userId: ${userId}`);
    return { statusCode: 200, body: 'Connected' };

  } catch (error) {
    diagnostics.error('Connection failed:', error);
    if (error.name === 'QlueError' || error.statusCode === 401) {
      return { statusCode: 401, body: 'Unauthorized: ' + error.message };
    }
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
