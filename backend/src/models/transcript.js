const { docClient } = require('./session');
const { PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const MESSAGES_TABLE = process.env.MESSAGES_TABLE_NAME || 'SessionMessages';

const SPEAKERS = {
    AI: 'AI',
    USER: 'USER'
};

/**
 * Saves a transcript message to DynamoDB.
 */
async function saveTranscript(sessionId, turnCount, speaker, content, confidence = null) {
    const messageId = `${Date.now()}_${speaker}`;
    const transcript = {
        sessionId,
        messageId,
        turnCount,
        speaker,
        content,
        timestamp: new Date().toISOString()
    };
    if (confidence !== null) transcript.confidence = confidence;

    const command = new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: transcript
    });
    
    await docClient.send(command);
    return transcript;
}

/**
 * Retrieves the last N transcripts for a given session.
 */
async function getTranscriptWindow(sessionId, limit = 5) {
    const command = new QueryCommand({
        TableName: MESSAGES_TABLE,
        KeyConditionExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: {
            ':sessionId': sessionId
        },
        ScanIndexForward: false, // get newest first
        Limit: limit * 2 // each Q&A pair is 2 messages (user + AI)
    });
    
    const res = await docClient.send(command);
    // Reverse to chronological order
    const items = res.Items || [];
    return items.reverse();
}

module.exports = {
    SPEAKERS,
    saveTranscript,
    getTranscriptWindow
};
