const { docClient } = require('../lib/dynamodb');
const { PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { randomUUID } = require('crypto');

const CORE_TABLE = process.env.CORE_TABLE;

const SPEAKERS = {
    USER: 'USER',
    AI: 'AI'
};

function getSessionPk(sessionId) {
    return `SESSION#${sessionId}`;
}

/**
 * Saves a transcript entry to the core table.
 * 
 * PK: SESSION#<sessionId>
 * SK: TURN#<zero-padded turnIndex>
 */
async function saveTranscript(sessionId, turnIndex, speaker, text, metadata = {}) {
    const timestamp = new Date().toISOString();
    const transcript = {
        PK: getSessionPk(sessionId),
        SK: `TURN#${String(turnIndex).padStart(4, '0')}`,
        sessionId,
        turnIndex,
        transcriptId: randomUUID(),
        speaker,
        text,
        timestamp,
        createdAt: timestamp,
        entityType: 'TRANSCRIPT',
        ...metadata
    };

    await docClient.send(new PutCommand({
        TableName: CORE_TABLE,
        Item: transcript
    }));

    return transcript;
}

/**
 * Retrieves the full transcript for a session, ordered by turnKey.
 */
async function getTranscriptBySession(sessionId) {
    const command = new QueryCommand({
        TableName: CORE_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': getSessionPk(sessionId), ':prefix': 'TURN#' },
        ScanIndexForward: true
    });
    const res = await docClient.send(command);
    return res.Items || [];
}

module.exports = {
    SPEAKERS,
    saveTranscript,
    getTranscriptBySession
};

module.exports = {
    SPEAKERS,
    saveTranscript,
    getTranscriptBySession
};
