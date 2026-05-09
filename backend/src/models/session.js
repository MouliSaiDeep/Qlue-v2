const { docClient } = require('../lib/dynamodb');
const { PutCommand, UpdateCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

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
    const nowMs = Date.now(); // BE-BUG #10 FIX: use numeric epoch for GSI_UserIdStartedAt (type N)
    const session = {
        sessionId,
        userId,
        moduleType,
        itemData,
        voiceId: itemData.voiceId || 'Tiffany',
        engine: itemData.engine || 'generative',
        currentState: INTERVIEW_STATES.INITIALIZING,
        turnCount: 0,
        startedAt: nowMs,     // Numeric — matches GSI_UserIdStartedAt type N
        startTime: now,       // ISO string kept for backward-compat display
        updatedAt: now,
        silenceRetries: 0,
        accumulatedScores: {},
        version: 1,
        activeMarker: "ACTIVE"
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
        ConsistentRead: true // Prevent eventual consistency race conditions
    });

    const response = await docClient.send(command);
    return response.Item;
}

/**
 * Sweeps the UserActiveIndex GSI to find any currently active session for a user.
 * BE-BUG #4 FIX: Auto-terminates zombie sessions older than 30 minutes.
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
    const session = response.Items?.[0] || null;

    if (session) {
        const ZOMBIE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
        const sessionAge = Date.now() - (session.startedAt || 0);
        if (sessionAge > ZOMBIE_THRESHOLD_MS) {
            console.warn(`[Session] Zombie session detected: ${session.sessionId} (age: ${Math.round(sessionAge / 60000)}m). Auto-terminating.`);
            try {
                await updateSessionState(session.sessionId, INTERVIEW_STATES.TERMINATED, null, {
                    terminationReason: 'ZOMBIE_CLEANUP'
                });
            } catch (e) {
                console.error(`[Session] Failed to auto-terminate zombie session ${session.sessionId}:`, e.message);
            }
            return null;
        }
    }

    return session;
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

    // BUG-10 FIX: Support atomic increment for turnCount to prevent race conditions
    if (updates.incrementTurnCount) {
        updateExpression += ", turnCount = if_not_exists(turnCount, :zero) + :inc";
        expressionAttributeValues[":zero"] = 0;
        expressionAttributeValues[":inc"] = 1;
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

    if (updates.voiceId !== undefined) {
        updateExpression += ", voiceId = :voiceId";
        expressionAttributeValues[":voiceId"] = updates.voiceId;
    }

    if (updates.engine !== undefined) {
        updateExpression += ", engine = :engine";
        expressionAttributeValues[":engine"] = updates.engine;
    }

    if (updates.connectionId !== undefined) {
        updateExpression += ", connectionId = :connectionId";
        expressionAttributeValues[":connectionId"] = updates.connectionId;
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
    getSessionById: getSession,
    updateSessionState,
    getActiveSessionForUser
};
