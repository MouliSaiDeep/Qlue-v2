/**
 * Model for managing WebSocket connection records in DynamoDB.
 */
const ddb = require('../lib/dynamodb');

const TABLE_NAME = process.env.WS_CONNECTIONS_TABLE || 'qlue-ws-connections';

/**
 * Finds user's active connection via GSI.
 */
async function getActiveConnectionByUserId(userId) {
  const result = await ddb.query(
    TABLE_NAME,
    'userId = :uid AND isActive = :active',
    {
      values: {
        ':uid': userId,
        ':active': 'true'
      },
      index: 'GSI_UserIdIsActive'
    }
  );

  if (result.success && result.data && result.data.length > 0) {
    return result.data[0];
  }
  return null;
}

/**
 * Register a new connection or update existing.
 */
async function saveConnection(connectionId, userId, sessionId = null) {
  const item = {
    connectionId,
    userId,
    sessionId,
    isActive: 'true',
    connectedAt: Date.now(),
    lastHeartbeat: Date.now(),
    ttl: Math.floor(Date.now() / 1000) + 7200 // 2 hours
  };

  return await ddb.put(TABLE_NAME, item);
}

/**
 * Deactivate a connection by ID.
 * Optional options.expectedIsActive for conditional update to prevent race conditions.
 */
async function deactivateConnection(connectionId, options = {}) {
  if (options.expectedIsActive) {
    // BUG-5 FIX: Use conditional write if expectedIsActive is provided
    const { docClient } = require('../lib/dynamodb');
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    
    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { connectionId },
        UpdateExpression: 'SET isActive = :val',
        ConditionExpression: 'isActive = :expected',
        ExpressionAttributeValues: {
          ':val': 'false',
          ':expected': options.expectedIsActive
        }
      }));
      return { success: true };
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Connection is no longer in the expected state
        throw error;
      }
      console.error(`DDB UPDATE Error | ${TABLE_NAME}`, error);
      return { success: false, error };
    }
  } else {
    // Default non-conditional deactivation
    return await ddb.update(
      TABLE_NAME,
      { connectionId },
      'SET isActive = :val',
      { ':val': 'false' }
    );
  }
}

/**
 * Update heartbeat timestamp.
 */
async function updateHeartbeat(connectionId) {
  return await ddb.update(
    TABLE_NAME,
    { connectionId },
    'SET lastHeartbeat = :ts',
    { ':ts': Date.now() }
  );
}

/**
 * Associate a session ID with a connection.
 */
async function associateSession(connectionId, sessionId) {
  return await ddb.update(
    TABLE_NAME,
    { connectionId },
    'SET sessionId = :sid',
    { ':sid': sessionId }
  );
}

/**
 * Get connection by primary key.
 */
async function getConnection(connectionId) {
  const result = await ddb.get(TABLE_NAME, { connectionId });
  return result.success ? result.data : null;
}

module.exports = {
  getActiveConnectionByUserId,
  saveConnection,
  deactivateConnection,
  updateHeartbeat,
  associateSession,
  getConnection
};
