const { docClient } = require('../lib/dynamodb');
const { PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { randomUUID } = require('crypto');

const TRANSCRIPTS_TABLE = process.env.TRANSCRIPTS_TABLE || 'qlue-transcripts';

const SPEAKERS = {
    USER: 'USER',
    AI: 'AI'
};

/**
 * Saves a transcript entry to DynamoDB.
 */
async function saveTranscript(sessionId, turnIndex, speaker, text) {
    const transcript = {
        transcriptId: randomUUID(),
        sessionId,
        turnIndex,
        speaker,
        text,
        timestamp: new Date().toISOString()
    };

    const command = new PutCommand({
        TableName: TRANSCRIPTS_TABLE,
        Item: transcript
    });

    await docClient.send(command);
    return transcript;
}

/**
 * Retrieves the full transcript for a session, ordered by turnIndex.
 */
async function getTranscriptBySession(sessionId) {
    const command = new QueryCommand({
        TableName: TRANSCRIPTS_TABLE,
        IndexName: 'GSI_SessionIdTurnIndex',
        KeyConditionExpression: 'sessionId = :sid',
        ExpressionAttributeValues: {
            ':sid': sessionId
        },
        ScanIndexForward: true // Ascending by turnIndex
    });

    const result = await docClient.send(command);
    return result.Items || [];
}

module.exports = {
    SPEAKERS,
    saveTranscript,
    getTranscriptBySession
};
