const diagnostics=require('../lib/logger').safeConsole;
const { docClient } = require('../lib/dynamodb');
const { UpdateCommand, GetCommand, QueryCommand, TransactWriteCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

// Per-user active-session lock. Stored in the same table under a deterministic
// PK so it can be written atomically with the session in one transaction. It
// carries no activeMarker/startedAt, so it never appears in either GSI.
const LOCK_TTL_SECONDS = 60 * 60; // orphan backstop; well above the 30m zombie threshold
function userLockKey(userId) {
  return `LOCK#${userId}`;
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

// I-01: explicit, persisted progress checkpoints for the SELF-INTRO coaching
// module. The intro flow is NOT driven by turnCount (silence re-prompts,
// transport retries, and model failures all left turnCount advancing, so the
// session "suddenly ended" after two pauses). Instead the stage advances ONLY
// when a user attempt is accepted and the corresponding AI turn is committed:
//   (opener) -> AWAITING_FIRST_ATTEMPT -> AWAITING_REVISED_ATTEMPT -> COMPLETE
// A complete intro therefore requires exactly two accepted attempts.
const INTRO_STAGES = {
    AWAITING_FIRST_ATTEMPT: "AWAITING_FIRST_ATTEMPT",
    AWAITING_REVISED_ATTEMPT: "AWAITING_REVISED_ATTEMPT",
    COMPLETE: "COMPLETE"
};

/**
 * Creates a new interview session AND claims the caller's single active-session
 * slot in one atomic transaction (audit finding 3). The session row and a
 * deterministic LOCK#<userId> row are written together; the lock's
 * `attribute_not_exists(sessionId)` condition is what actually enforces "one
 * active interview per user" — the prior GSI pre-check was racy.
 *
 * Throws an Error with code 'ACTIVE_SESSION_EXISTS' if the user already holds
 * the lock. An orphaned lock (its session already gone/terminal) is reconciled
 * and the create retried once, so a failed release can't lock a user out.
 */
async function createSession(sessionId, userId, moduleType, itemData = {}) {
    const now = new Date().toISOString();
    const nowMs = Date.now(); // BE-BUG #10 FIX: use numeric epoch for GSI_UserIdStartedAt (type N)
    const session = {
        sessionId,
        userId,
        moduleType,
        itemData,
        voiceId: require('../lib/voicePolicy').preference(itemData.voiceId).voiceId,
        engine: itemData.engine || 'neural',
        currentState: INTERVIEW_STATES.INITIALIZING,
        turnCount: 0,
        answeredCount: 0, // known empty; absent counts belong to legacy sessions
        acceptedAnswerIds: [],
        answerIdentityVersion: 1,
        startedAt: nowMs,     // Numeric — matches GSI_UserIdStartedAt type N
        startTime: now,       // ISO string kept for backward-compat display
        updatedAt: now,
        silenceRetries: 0,
        accumulatedScores: {},
        version: 1,
        activeMarker: "ACTIVE"
    };

    const lockItem = {
        sessionId: userLockKey(userId), // PK; NOT a real session, excluded from GSIs
        userId,
        lockType: 'ACTIVE_SESSION',
        lockedSessionId: sessionId,
        createdAt: now,
        expiresAt: Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS
    };

    const buildTxn = () => new TransactWriteCommand({
        TransactItems: [
            require('../lib/deletionJob').deletionFence(userId),
            { Put: { TableName: SESSIONS_TABLE, Item: session, ConditionExpression: "attribute_not_exists(sessionId)" } },
            { Put: { TableName: SESSIONS_TABLE, Item: lockItem, ConditionExpression: "attribute_not_exists(sessionId)" } }
        ]
    });

    try {
        await require('../lib/deadline').sendBounded(docClient,buildTxn());
        return session;
    } catch (err) {
        if (err.name !== 'TransactionCanceledException') throw err;
        // Reconcile: if the existing lock points at a session that no longer
        // exists or is terminal, it's orphaned — clear it and retry once.
        const reclaimed = await reconcileStaleLock(userId);
        if (!reclaimed) {
            const e = new Error('User already has an active interview session.');
            e.code = 'ACTIVE_SESSION_EXISTS';
            throw e;
        }
        try {
            await require('../lib/deadline').sendBounded(docClient,buildTxn());
            return session;
        } catch (retryErr) {
            if (retryErr.name === 'TransactionCanceledException') {
                const e = new Error('User already has an active interview session.');
                e.code = 'ACTIVE_SESSION_EXISTS';
                throw e;
            }
            throw retryErr;
        }
    }
}

/**
 * Deletes the active-session lock if it is orphaned (its session is missing or
 * in a terminal state, or the lock has expired). Returns true if a stale lock
 * was cleared, false if the lock is still validly held.
 */
async function reconcileStaleLock(userId) {
    const lockRes = await require('../lib/deadline').sendBounded(docClient,new GetCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId: userLockKey(userId) },
        ConsistentRead: true
    }));
    const lock = lockRes.Item;
    if (!lock) return true; // lock vanished (released concurrently) — safe to retry

    const nowSec = Math.floor(Date.now() / 1000);
    let stale = lock.expiresAt && lock.expiresAt < nowSec;

    if (!stale && lock.lockedSessionId) {
        const s = await getSession(lock.lockedSessionId);
        const terminal = !s
            || s.currentState === INTERVIEW_STATES.TERMINATED
            || s.currentState === INTERVIEW_STATES.ERROR
            || s.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK;
        stale = terminal;
    }
    if (!stale) return false;

    // Conditional delete so we only remove the exact orphaned lock we inspected,
    // never a fresh one a concurrent init may have just written.
    try {
        await require('../lib/deadline').sendBounded(docClient,new DeleteCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: userLockKey(userId) },
            ConditionExpression: 'lockedSessionId = :lsid',
            ExpressionAttributeValues: { ':lsid': lock.lockedSessionId }
        }));
    } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') throw err;
    }
    return true;
}

/**
 * Best-effort release of the user's active-session lock. Called when a session
 * reaches a terminal state; failures are logged, not thrown (the lock TTL and
 * reconcile-on-conflict are the backstops).
 */
async function releaseUserSessionLock(userId, sessionId) {
    if (!userId) return;
    try {
        await require('../lib/deadline').sendBounded(docClient,new DeleteCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId: userLockKey(userId) },
            // Only release if this session owns the lock, so a newer session's
            // lock isn't deleted by a late terminal transition of an old one.
            ...(sessionId ? {
                ConditionExpression: 'attribute_not_exists(lockedSessionId) OR lockedSessionId = :sid',
                ExpressionAttributeValues: { ':sid': sessionId }
            } : {})
        }));
    } catch (err) {
        if (err.name !== 'ConditionalCheckFailedException') {
            diagnostics.error(`[Session] Failed to release active-session lock for ${userId}:`, err.name);
        }
    }
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

    const response = await require('../lib/deadline').sendBounded(docClient,command);
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

    const response = await require('../lib/deadline').sendBounded(docClient,command);
    const session = response.Items?.[0] || null;

    if (session) {
        const ZOMBIE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
        const sessionAge = Date.now() - (session.startedAt || 0);
        if (sessionAge > ZOMBIE_THRESHOLD_MS) {
            diagnostics.warn(`[Session] Zombie session detected: ${session.sessionId} (age: ${Math.round(sessionAge / 60000)}m). Auto-terminating.`);
            try {
                await updateSessionState(session.sessionId, INTERVIEW_STATES.TERMINATED, null, {
                    terminationReason: 'ZOMBIE_CLEANUP'
                });
            } catch (e) {
                diagnostics.error(`[Session] Failed to auto-terminate zombie session ${session.sessionId}:`, e.name);
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
    let conditionExpression = 'attribute_exists(sessionId)';

    if (expectedCurrentState) {
        conditionExpression += " AND currentState = :expectedCurrentState";
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

    // I-08: durable count of ACCEPTED user answers, incremented by processUserInput
    // the moment a real (non-silence) answer is persisted. terminateSession's
    // discard-empty check reads this strongly-consistent session attribute rather
    // than the eventually-consistent transcripts GSI, so a session that was just
    // answered is never discarded as "empty" merely because its index lags.
    if (updates.incrementAnsweredCount) {
        updateExpression += ", answeredCount = if_not_exists(answeredCount, :zero) + :one";
        expressionAttributeValues[":zero"] = 0;
        expressionAttributeValues[":one"] = 1;
    }

    if (updates.expectedTurnCount !== undefined) {
        if (conditionExpression) {
            conditionExpression += " AND turnCount = :expectedTurnCount";
        } else {
            conditionExpression = "turnCount = :expectedTurnCount";
        }
        expressionAttributeValues[":expectedTurnCount"] = updates.expectedTurnCount;
    }

    for (const field of ['leaseOwner', 'leaseVersion', 'leaseExpiresAt', 'jobId', 'feedbackAttemptId']) {
        const expected = `expected${field[0].toUpperCase()}${field.slice(1)}`;
        if (updates[expected] !== undefined) {
            conditionExpression += ` AND ${field} = :${expected}`;
            expressionAttributeValues[`:${expected}`] = updates[expected];
        }
    }
    if(Object.hasOwn(updates,'expectedFeedbackAttemptId')&&updates.expectedFeedbackAttemptId===undefined) conditionExpression+=' AND attribute_not_exists(feedbackAttemptId)';
    if (updates.reclaimBefore !== undefined) {
        conditionExpression += ' AND (attribute_not_exists(leaseExpiresAt) OR leaseExpiresAt <= :reclaimBefore)';
        expressionAttributeValues[':reclaimBefore'] = updates.reclaimBefore;
    }
    for (const field of ['leaseVersion', 'jobId', 'jobAttemptCount', 'clientTurnId', 'pendingAnswer', 'lastTurnPayload', 'expectsAnswer', 'acceptedAnswer', 'acceptedAnswerId', 'feedbackStatus', 'feedbackAttemptId', 'feedbackAttemptStartedAt', 'pendingJob']) {
        if (updates[field] !== undefined) {
            updateExpression += `, ${field} = :${field}`;
            expressionAttributeValues[`:${field}`] = updates[field];
        }
    }

    updateExpression += ", updatedAt = :updatedAt";
    expressionAttributeValues[":updatedAt"] = new Date().toISOString();
    
    // 3-STRIKE SYSTEM: persist the off-topic counter (updateSessionState is
    // whitelist-based; without this entry the count silently never advanced).
    if (updates.offTopicStrikes !== undefined) {
        updateExpression += ", offTopicStrikes = :offTopicStrikes";
        expressionAttributeValues[":offTopicStrikes"] = updates.offTopicStrikes;
    }

    // DISCARD FIX: flag sessions ended with zero user answers.
    if (updates.discarded !== undefined) {
        updateExpression += ", discarded = :discarded";
        expressionAttributeValues[":discarded"] = updates.discarded;
    }

    if (updates.silenceRetries !== undefined) {
        updateExpression += ", silenceRetries = :silenceRetries";
        expressionAttributeValues[":silenceRetries"] = updates.silenceRetries;
    }
    if (updates.feedbackExpected !== undefined) {
        updateExpression += ", feedbackExpected = :feedbackExpected";
        expressionAttributeValues[":feedbackExpected"] = updates.feedbackExpected;
    }
    if (updates.acceptedAnswerIds !== undefined) {
        updateExpression += ", acceptedAnswerIds = :acceptedAnswerIds";
        expressionAttributeValues[":acceptedAnswerIds"] = updates.acceptedAnswerIds;
    }
    for (const field of ['clarificationRetries', 'clarificationId', 'fragmentRetries', 'fragmentIds', 'answerAudioExpectedIds', 'answerAudioClosed', 'answerAudioCleanupPending']) {
        if (updates[field] !== undefined) {
            updateExpression += `, ${field} = :${field}`;
            expressionAttributeValues[`:${field}`] = updates[field];
        }
    }

    // I-04: worker lease expiry. Stamped when a worker claims a turn into
    // LOADING_CONTEXT so a crashed worker's turn can be reclaimed by its SQS
    // retry after the lease elapses, while a still-running lease is never stolen.
    if (updates.leaseExpiresAt !== undefined) {
        updateExpression += ", leaseExpiresAt = :leaseExpiresAt";
        expressionAttributeValues[":leaseExpiresAt"] = updates.leaseExpiresAt;
    }
    if (updates.leaseOwner !== undefined) {
        updateExpression += ", leaseOwner = :leaseOwner";
        expressionAttributeValues[":leaseOwner"] = updates.leaseOwner;
    }

    // I-01: persisted SELF-INTRO stage. Whitelist-based updateSessionState would
    // silently drop this field without an explicit entry, so the stage could
    // never advance and the module fell back to its (buggy) turnCount behavior.
    if (updates.introStage !== undefined) {
        updateExpression += ", introStage = :introStage";
        expressionAttributeValues[":introStage"] = updates.introStage;
    }

    // R-05: feedback outbox. The job map is persisted ATOMICALLY with the
    // GENERATING_FEEDBACK transition so a publish that later fails leaves a
    // durable, retryable record instead of a wedged session.
    if (updates.feedbackJob !== undefined) {
        updateExpression += ", feedbackJob = :feedbackJob";
        expressionAttributeValues[":feedbackJob"] = updates.feedbackJob;
    }
    // R-05: sparse dispatch marker driving the FeedbackDispatchIndex. A non-null
    // value SETS the marker (and stamps feedbackJobUpdatedAt, the index sort key,
    // so the dispatcher's grace-period cursor advances); an explicit null REMOVEs
    // it so a dispatched/parked job leaves the index. The attribute's absence is
    // what keeps the index sparse — only genuinely-pending jobs ever appear.
    let removeDispatchMarker = false;
    let setDispatchMarker = false;
    if (updates.feedbackDispatchPending !== undefined) {
        if (updates.feedbackDispatchPending === null) {
            removeDispatchMarker = true;
        } else {
            setDispatchMarker = true;
            updateExpression += ", feedbackDispatchPending = :feedbackDispatchPending, feedbackJobUpdatedAt = :feedbackJobUpdatedAt";
            expressionAttributeValues[":feedbackDispatchPending"] = updates.feedbackDispatchPending;
            expressionAttributeValues[":feedbackJobUpdatedAt"] = Date.now();
        }
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
    const removeFields = [];
    if (newState === INTERVIEW_STATES.TERMINATED || newState === INTERVIEW_STATES.ERROR || newState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
        removeFields.push("activeMarker");
        if (updates.terminationReason) {
            updateExpression += ", terminationReason = :terminationReason";
            expressionAttributeValues[":terminationReason"] = updates.terminationReason;
        }
    }
    // R-05: a feedback job that reaches a terminal state (dispatched -> TERMINATED,
    // or ERROR) must leave the dispatch index. Removing the sparse marker here
    // means the normal "publish succeeded, now TERMINATED" path drops the job
    // from the dispatcher WITHOUT any extra conditional write at the call site.
    // Guard against SET+REMOVE of the same path in one expression (DynamoDB
    // rejects overlaps): a terminal transition never also sets the marker.
    if ((newState === INTERVIEW_STATES.TERMINATED || newState === INTERVIEW_STATES.ERROR) && !setDispatchMarker) {
        removeDispatchMarker = true;
    }
    if (removeDispatchMarker && !setDispatchMarker) {
        removeFields.push("feedbackDispatchPending");
    }
    if (removeFields.length > 0) {
        removeExpression = " REMOVE " + removeFields.join(", ");
    }

    const command = new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression: updateExpression + removeExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: conditionExpression,
        ReturnValues: "ALL_NEW"
    });

    const owner = updates.guardUserId || (await getSession(sessionId))?.userId;
    if (!owner) { const e=new Error('Session is gone'); e.name='ConditionalCheckFailedException'; throw e; }
    const transaction = updates.transactionItems?.length ? new TransactWriteCommand({TransactItems:[{Update:{...command.input,ReturnValues:undefined}},...updates.transactionItems]}) : command;
    const response = await require('../lib/dynamodb').fencedSend(transaction, owner);
    if (transaction !== command) response.Attributes = await getSession(sessionId);

    // Release the per-user active-session lock whenever the active marker is
    // cleared (terminal / error / feedback), using the userId from the updated
    // item. Best-effort: the lock TTL and reconcile-on-conflict are backstops.
    if (removeExpression && response.Attributes?.userId) {
        await releaseUserSessionLock(response.Attributes.userId, sessionId);
    }

    return response.Attributes;
}

module.exports = {
    INTERVIEW_STATES,
    INTRO_STAGES,
    createSession,
    getSession,
    getSessionById: getSession,
    updateSessionState,
    getActiveSessionForUser,
    releaseUserSessionLock
};
