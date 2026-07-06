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

/**
 * Retrieves the most recent transcripts for a session, ordered by turnIndex descending.
 * Useful for finding the last AI turn or a small window of history efficiently.
 */
async function getLatestTranscripts(sessionId, limit = 5) {
    const command = new QueryCommand({
        TableName: TRANSCRIPTS_TABLE,
        IndexName: 'GSI_SessionIdTurnIndex',
        KeyConditionExpression: 'sessionId = :sid',
        ExpressionAttributeValues: {
            ':sid': sessionId
        },
        ScanIndexForward: false, // Descending by turnIndex
        Limit: limit
    });

    const result = await docClient.send(command);
    return result.Items || [];
}

/**
 * PERF-FIX #3: Efficient LLM context window fetch.
 * Previously the async worker fetched the FULL transcript on every turn and
 * truncated in memory. This queries only the most recent `maxMessages` items
 * (descending, then reversed to chronological order). If the window no longer
 * reaches the start of the session, the very first turn is fetched separately
 * and pinned to the front, preserving the original "first message + recent"
 * truncation behaviour at a fraction of the read cost.
 */
async function getContextWindow(sessionId, maxMessages = 20) {
    const recentDesc = await getLatestTranscripts(sessionId, maxMessages);
    const window = recentDesc.slice().reverse(); // chronological

    if (window.length === 0) return [];

    const earliestFetchedTurn = window[0].turnIndex || 0;
    if (window.length === maxMessages && earliestFetchedTurn > 0) {
        // Pin the opening exchange so the model keeps the interview framing.
        const firstCommand = new QueryCommand({
            TableName: TRANSCRIPTS_TABLE,
            IndexName: 'GSI_SessionIdTurnIndex',
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: { ':sid': sessionId },
            ScanIndexForward: true,
            Limit: 1
        });
        const firstResult = await docClient.send(firstCommand);
        const first = firstResult.Items?.[0];
        if (first) {
            // Drop the oldest item in the window to keep size at maxMessages.
            return [first, ...window.slice(1)];
        }
    }

    return window;
}

module.exports = {
    SPEAKERS,
    saveTranscript,
    getTranscriptBySession,
    getLatestTranscripts,
    getContextWindow
};
