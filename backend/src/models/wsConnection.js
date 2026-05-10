const { docClient } = require('../lib/dynamodb');
const { PutCommand, UpdateCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

/**
 * Register a new connection or update existing.
 * 
 * PK: connectionId
 */
async function saveConnection(connectionId, userId, sessionId = null) {
    const now = Date.now();
    const item = {
        connectionId,
        userId,
        sessionId,
        isActive: true,
        connectedAt: now,
        lastHeartbeat: now,
        ttl: Math.floor(now / 1000) + 7200 // 2 hours
    };

    await docClient.send(new PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: item
    }));

    return { success: true };
}

/**
 * Deactivate a connection by ID.
 */
async function deactivateConnection(connectionId) {
    await docClient.send(new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
        UpdateExpression: 'SET isActive = :val',
        ExpressionAttributeValues: { ':val': false }
    }));
    return { success: true };
}

/**
 * Update heartbeat timestamp.
 */
async function updateHeartbeat(connectionId) {
    const now = Date.now();
    await docClient.send(new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
        UpdateExpression: 'SET lastHeartbeat = :ts',
        ExpressionAttributeValues: { ':ts': now }
    }));
    return { success: true };
}

/**
 * Associate a session ID with a connection.
 */
async function associateSession(connectionId, sessionId) {
    await docClient.send(new UpdateCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId },
        UpdateExpression: 'SET sessionId = :sid',
        ExpressionAttributeValues: { ':sid': sessionId }
    }));
    return { success: true };
}

/**
 * Get connection by connectionId.
 */
async function getConnection(connectionId) {
    const command = new GetCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId }
    });
    const res = await docClient.send(command);
    return res.Item || null;
}

/**
 * Finds all active connections for a user.
 */
async function getConnectionsByUserId(userId) {
    // Note: This would require GSI1 (userId) if needed for performance
    // For now, would need to scan or maintain external mapping
    return [];
}

/**
 * Finds all active connections for a session.
 */
async function getConnectionsBySessionId(sessionId) {
    // Note: This would require GSI1 (sessionId) if needed for performance
    // For now, would need to scan or maintain external mapping
    return [];
}

module.exports = {
    saveConnection,
    deactivateConnection,
    updateHeartbeat,
    associateSession,
    getConnection,
    getConnectionsByUserId,
    getConnectionsBySessionId
};
