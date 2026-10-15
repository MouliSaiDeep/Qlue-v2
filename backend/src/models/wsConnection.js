const diagnostics=require('../lib/logger').safeConsole;
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
 *
 * R-10: the connection's authorization window is bound to the VERIFIED token
 * that opened it. `$connect` passes the decoded token's `exp` (epoch seconds)
 * as `options.authExpiresAt`; the row ttl follows it so a socket can never
 * outlive the credential that authenticated it. Only a fresh `$connect` (which
 * re-verifies a token) may reset this — a session-level reconnect MESSAGE must
 * not silently extend it. When `exp` is absent we fall back to a bounded
 * default rather than an open-ended window.
 */
const MAX_CONNECTION_TTL_SEC = 2 * 60 * 60; // fallback cap when a token exp is unavailable

async function saveConnection(connectionId, userId, sessionId = null, options = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const authExpiresAt = Number.isFinite(options.authExpiresAt) ? options.authExpiresAt : null;
  // Never longer than the credential's own lifetime; never longer than the cap.
  const ttl = (authExpiresAt && authExpiresAt > nowSec)
    ? Math.min(authExpiresAt, nowSec + MAX_CONNECTION_TTL_SEC)
    : nowSec + MAX_CONNECTION_TTL_SEC;

  const item = {
    connectionId,
    userId,
    sessionId,
    isActive: 'true',
    connectedAt: Date.now(),
    lastHeartbeat: Date.now(),
    emailVerified: options.emailVerified === true,
    ...(authExpiresAt && { authExpiresAt }),
    ttl
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
      await require('../lib/deadline').sendBounded(docClient,new UpdateCommand({
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
      diagnostics.error(`DDB UPDATE Error | ${TABLE_NAME}`, error);
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
  if (!connectionId) return null;
  const result = await ddb.get(TABLE_NAME, { connectionId },{consistentRead:true});
  return result?.success ? result.data : null;
}

/**
 * Deactivate ALL active connections for a user (revocation / account deletion).
 *
 * Marking a connection isActive='false' is the authoritative revocation: the
 * $default message gate rejects any frame whose connection row is not active,
 * so an in-flight socket can no longer drive a session even before its ttl
 * elapses. Iterates every active row via GSI_UserIdIsActive (paginated) so a
 * user with multiple devices is fully covered.
 *
 * Throws on a read failure so callers that require completeness (account
 * deletion) fail closed instead of silently leaving connections live.
 *
 * @returns {Promise<number>} number of connections deactivated
 */
async function deactivateConnectionsByUserId(userId) {
  if (!userId) return 0;
  let deactivated = 0;
  let lastKey;
  do {
    const res = await ddb.query(
      TABLE_NAME,
      'userId = :uid AND isActive = :active',
      {
        values: { ':uid': userId, ':active': 'true' },
        index: 'GSI_UserIdIsActive',
        ...(lastKey && { exclusiveStartKey: lastKey })
      }
    );
    if (!res.success) {
      throw new Error(`Failed to list active connections for user: ${res.error?.message || 'query failed'}`);
    }
    for (const conn of res.data || []) {
      // A connection already flipped to false by a concurrent $connect reconnect
      // is fine to skip (ConditionalCheckFailedException). Any OTHER failure is a
      // denied/failed write: R-03/R-10 require this to fail closed for account
      // deletion / revocation, not silently count as revoked. deactivateConnection
      // maps a non-conditional error to {success:false} rather than throwing, so
      // inspect the result too.
      let result;
      try {
        result = await deactivateConnection(conn.connectionId, { expectedIsActive: 'true' });
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') continue; // already inactive
        throw err;
      }
      if (result && result.success === false) {
        throw new Error(
          `Failed to deactivate connection ${conn.connectionId}: ${result.error?.message || 'write failed'}`
        );
      }
      deactivated++;
    }
    lastKey = res.lastEvaluatedKey;
  } while (lastKey);
  return deactivated;
}

module.exports = {
  getActiveConnectionByUserId,
  saveConnection,
  deactivateConnection,
  deactivateConnectionsByUserId,
  updateHeartbeat,
  associateSession,
  getConnection
};
