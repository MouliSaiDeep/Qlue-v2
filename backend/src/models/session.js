const { docClient } = require('../lib/dynamodb');
const { PutCommand, UpdateCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || "Sessions";

const INTERVIEW_STATES = {
    INITIALIZING: "INITIALIZING",
    LOADING_CONTEXT: "LOADING_CONTEXT",
    AI_SPEAKING: "AI_SPEAKING",
    USER_RESPONDING: "USER_RESPONDING",
    PROCESSING_RESPONSE: "PROCESSING_RESPONSE",
    GENERATING_FEEDBACK: "GENERATING_FEEDBACK",
    SILENCE_DETECTED: "SILENCE_DETECTED",
    TERMINATED: "TERMINATED",
    ERROR: "ERROR"
};

/**
 * Creates a new interview session in DynamoDB.
 */
async function createSession(sessionId, userId, moduleType, itemData = {}) {
    const now = new Date().toISOString();
    const session = {
        sessionId,
        userId,
        moduleType,
        itemData, // [Mouli Week 4: Context Injection] Store resumeId/websiteUrl context
        voiceId: itemData.voiceId || 'Tiffany',
        currentState: INTERVIEW_STATES.INITIALIZING,
        turnCount: 0,
        startTime: now,
        updatedAt: now, // FIX: added
        silenceRetries: 0,
        accumulatedScores: {},
        version: 1,
        activeMarker: "ACTIVE" // Used for Sparse GSI pattern
    };

    const command = new PutCommand({
        TableName: SESSIONS_TABLE,
        Item: session,
    });

    await docClient.send(command);
    return session;
}

/**
 * Retrieves a session by its ID.
 */
async function getSession(sessionId) {
    const command = new GetCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
    });

    const response = await docClient.send(command);
    return response.Item;
}

/**
 * Sweeps the UserActiveIndex GSI to find any currently active session for a user.
 */
async function getActiveSessionForUser(userId) {
    const command = new QueryCommand({
        TableName: SESSIONS_TABLE,
        IndexName: 'UserActiveIndex',
        KeyConditionExpression: 'userId = :uid AND activeMarker = :am',
        ExpressionAttributeValues: {
            ':uid': userId,
            ':am': 'ACTIVE'
        },
        Limit: 1
    });

    const response = await docClient.send(command);
    return response.Items?.[0] || null;
}

/**
 * Updates the current state of the interview session, enforcing optimistic locking.
 */
async function updateSessionState(sessionId, newState, expectedCurrentState = null, updates = {}) {
    let updateExpression = "SET currentState = :newState, version = if_not_exists(version, :zero) + :one";
    const expressionAttributeValues = {
        ":newState": newState,
        ":zero": 0,
        ":one": 1
    };
    let conditionExpression = undefined;

    if (expectedCurrentState) {
        conditionExpression = "currentState = :expectedCurrentState";
        expressionAttributeValues[":expectedCurrentState"] = expectedCurrentState;
    }

    if (updates.expectedVersion !== undefined) {
        if (conditionExpression) {
            conditionExpression += " AND version = :expectedVersion";
        } else {
            conditionExpression = "version = :expectedVersion";
        }
        expressionAttributeValues[":expectedVersion"] = updates.expectedVersion;
    }

    if (updates.turnCount !== undefined) {
        updateExpression += ", turnCount = :turnCount";
        expressionAttributeValues[":turnCount"] = updates.turnCount;
    }

    if (updates.expectedTurnCount !== undefined) {
        if (conditionExpression) {
            conditionExpression += " AND turnCount = :expectedTurnCount";
        } else {
            conditionExpression = "turnCount = :expectedTurnCount";
        }
        expressionAttributeValues[":expectedTurnCount"] = updates.expectedTurnCount;
    }

    updateExpression += ", updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = new Date().toISOString();
    
    if (updates.silenceRetries !== undefined) {
        updateExpression += ", silenceRetries = :silenceRetries";
        expressionAttributeValues[":silenceRetries"] = updates.silenceRetries;
    }

    if (updates.accumulatedScores !== undefined) {
        updateExpression += ", accumulatedScores = :accumulatedScores";
        expressionAttributeValues[":accumulatedScores"] = updates.accumulatedScores;
    }

    if (updates.questionText !== undefined) {
        updateExpression += ", questionText = :questionText";
        expressionAttributeValues[":questionText"] = updates.questionText;
    }

    if (updates.currentConceptId !== undefined) {
        updateExpression += ", currentConceptId = :currentConceptId";
        expressionAttributeValues[":currentConceptId"] = updates.currentConceptId;
    }

    if (updates.scrapedSummary !== undefined) {
        updateExpression += ", scrapedSummary = :scrapedSummary";
        expressionAttributeValues[":scrapedSummary"] = updates.scrapedSummary;
    }
    
    // Cleanup active marker if terminated
    let removeExpression = "";
    if (newState === INTERVIEW_STATES.TERMINATED || newState === INTERVIEW_STATES.ERROR || newState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
        removeExpression = " REMOVE activeMarker";
        if (updates.terminationReason) {
            updateExpression += ", terminationReason = :terminationReason";
            expressionAttributeValues[":terminationReason"] = updates.terminationReason;
        }
    }

    const command = new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression: updateExpression + removeExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: conditionExpression,
        ReturnValues: "ALL_NEW"
    });

    const response = await docClient.send(command);
    return response.Attributes;
}

module.exports = {
    INTERVIEW_STATES,
    createSession,
    getSession,
    updateSessionState,
    getActiveSessionForUser
};
