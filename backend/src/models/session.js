const { docClient } = require('../lib/dynamodb');
const { PutCommand, UpdateCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const CORE_TABLE = process.env.CORE_TABLE;

function getSessionPk(sessionId) {
    return `SESSION#${sessionId}`;
}

function getUserPk(userId) {
    return `USER#${userId}`;
}

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
 * Creates a new interview session.
 * 
 * PK: SESSION#<sessionId>
 * SK: METADATA
 * GSI1PK: USER#<userId>
 * GSI1SK: SESSION#<startedAt>
 */
async function createSession(sessionId, userId, moduleType, itemData = {}) {
    const now = new Date().toISOString();
    const session = {
        PK: getSessionPk(sessionId),
        SK: 'METADATA',
        sessionId,
        userId,
        GSI1PK: getUserPk(userId),
        GSI1SK: `SESSION#${now}`,
        entityType: 'SESSION',
        moduleType,
        itemData,
        voiceId: itemData.voiceId || 'Tiffany',
        currentState: INTERVIEW_STATES.INITIALIZING,
        turnCount: 0,
        startedAt: now,
        updatedAt: now,
        silenceRetries: 0,
        accumulatedScores: {},
        version: 1,
        status: 'ACTIVE',
        contextWindow: [],
        conceptStates: {},  // Embedded concept states
        feedback: null,      // Embedded feedback report
        feedbackId: null
    };

    await docClient.send(new PutCommand({
        TableName: CORE_TABLE,
        Item: session
    }));

    return session;
}

/**
 * Retrieves a session by its ID.
 */
async function getSession(sessionId) {
    const command = new GetCommand({
        TableName: CORE_TABLE,
        Key: { PK: getSessionPk(sessionId), SK: 'METADATA' }
    });
    const res = await docClient.send(command);
    return res.Item || null;
}

/**
 * Finds the currently active session for a user.
 */
async function getActiveSessionForUser(userId) {
    const command = new QueryCommand({
        TableName: CORE_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': getUserPk(userId) },
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pk': getUserPk(userId), ':active': 'ACTIVE' },
        ScanIndexForward: false,
        Limit: 1
    });
    const res = await docClient.send(command);
    return (res.Items && res.Items.length > 0) ? res.Items[0] : null;
}

/**
 * Updates the session state, enforcing optimistic locking.
 */
async function updateSessionState(userId, sessionId, newState, expectedCurrentState = null, updates = {}) {
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
        conditionExpression = conditionExpression ? `${conditionExpression} AND version = :expectedVersion` : "version = :expectedVersion";
        expressionAttributeValues[":expectedVersion"] = updates.expectedVersion;
    }

    const now = new Date().toISOString();
    updateExpression += ", updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = now;

    const fields = [
        'silenceRetries', 'accumulatedScores', 'questionText',
        'currentConceptId', 'scrapedSummary', 'contextWindow',
        'conceptStates', 'feedback', 'feedbackStatus', 'feedbackId'
    ];

    fields.forEach(field => {
        if (updates[field] !== undefined) {
            updateExpression += `, ${field} = :${field}`;
            expressionAttributeValues[`:${field}`] = updates[field];
        }
    });

    // Update status based on state
    if (newState === INTERVIEW_STATES.TERMINATED || newState === INTERVIEW_STATES.ERROR) {
        updateExpression += ", #status = :terminated";
        expressionAttributeValues[":terminated"] = 'TERMINATED';
        expressionAttributeNames = { '#status': 'status' };
    } else if (newState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
        updateExpression += ", #status = :feedbackGen";
        expressionAttributeValues[":feedbackGen"] = 'GENERATING_FEEDBACK';
        expressionAttributeNames = { '#status': 'status' };
    } else {
        updateExpression += ", #status = :active";
        expressionAttributeValues[":active"] = 'ACTIVE';
        expressionAttributeNames = { '#status': 'status' };
    }

    if (updates.terminationReason) {
        updateExpression += ", terminationReason = :terminationReason";
        expressionAttributeValues[":terminationReason"] = updates.terminationReason;
    }

    const res = await docClient.send(new UpdateCommand({
        TableName: CORE_TABLE,
        Key: { PK: getSessionPk(sessionId), SK: 'METADATA' },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        ConditionExpression: conditionExpression,
        ReturnValues: "ALL_NEW"
    }));

    return res.Attributes;
}

/**
 * Lists all sessions for a user, newest first.
 */
async function getSessionsByUserId(userId, limit = 20) {
    const command = new QueryCommand({
        TableName: CORE_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': getUserPk(userId) },
        ScanIndexForward: false,
        Limit: limit
    });
    const res = await docClient.send(command);
    return res.Items || [];
}

/**
 * Updates or creates a concept state within a session (embedded).
 */
async function updateConceptState(sessionId, conceptId, state, attemptIncrement = 1) {
    const res = await docClient.send(new UpdateCommand({
        TableName: CORE_TABLE,
        Key: { PK: getSessionPk(sessionId), SK: 'METADATA' },
        UpdateExpression: 'SET conceptStates = if_not_exists(conceptStates, :emptyMap), conceptStates.#cid = :conceptObj, updatedAt = :ua',
        ExpressionAttributeNames: { '#cid': conceptId },
        ExpressionAttributeValues: {
            ':emptyMap': {},
            ':conceptObj': { state: state, attempts: attemptIncrement },
            ':ua': new Date().toISOString()
        },
        ReturnValues: 'ALL_NEW'
    }));

    return res.Attributes?.conceptStates?.[conceptId];
}

/**
 * Retrieves all concepts for a given session (embedded).
 */
async function getConceptsBySession(sessionId) {
    const session = await getSession(sessionId);
    if (!session || !session.conceptStates) return [];

    return Object.entries(session.conceptStates).map(([conceptId, data]) => ({
        conceptId,
        ...data
    }));
}

/**
 * Selects the next appropriate concept for the Adaptive Tutor.
 */
async function selectNextConcept(sessionId) {
    const concepts = await getConceptsBySession(sessionId);
    if (!concepts || concepts.length === 0) return null;

    const CONCEPT_STATES = {
        UNADDRESSED: 'UNADDRESSED',
        TUTORED: 'TUTORED',
        MASTERED: 'MASTERED'
    };

    const unaddressed = concepts.find(c => c.state === CONCEPT_STATES.UNADDRESSED);
    if (unaddressed) return unaddressed;

    const tutored = concepts.find(c => c.state === CONCEPT_STATES.TUTORED && (c.attempts || 0) < 3);
    if (tutored) return tutored;

    return null;
}

/**
 * Stores a feedback report embedded in the session.
 */
async function storeFeedbackReport(sessionId, feedbackData) {
    const feedbackId = feedbackData.feedbackId || randomUUID();
    const generatedAt = new Date().toISOString();

    const feedback = {
        feedbackId,
        ...feedbackData,
        generatedAt
    };

    const res = await docClient.send(new UpdateCommand({
        TableName: CORE_TABLE,
        Key: { PK: getSessionPk(sessionId), SK: 'METADATA' },
        UpdateExpression: 'SET feedback = :feedback, feedbackId = :feedbackId, feedbackStatus = :feedbackStatus, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
            ':feedback': feedback,
            ':feedbackId': feedbackId,
            ':feedbackStatus': 'COMPLETE',
            ':updatedAt': generatedAt
        },
        ReturnValues: 'ALL_NEW'
    }));

    return { success: true, feedbackId, data: feedback };
}

/**
 * Retrieves feedback report from a session.
 */
async function getFeedbackBySessionId(sessionId) {
    const session = await getSession(sessionId);
    return session?.feedback || null;
}

module.exports = {
    INTERVIEW_STATES,
    createSession,
    getSession,
    getSessionPk,
    updateSessionState,
    getActiveSessionForUser,
    getSessionsByUserId,
    updateConceptState,
    getConceptsBySession,
    selectNextConcept,
    storeFeedbackReport,
    getFeedbackBySessionId
};

module.exports = {
    INTERVIEW_STATES,
    createSession,
    getSession,
    updateSessionState,
    getActiveSessionForUser,
    getSessionsByUserId
};
