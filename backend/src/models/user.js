const { get, put, update } = require('../lib/dynamodb');

const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

/**
 * Creates or updates a user profile record.
 */
async function saveUser(user) {
    const item = {
        ...user,
        updatedAt: new Date().toISOString()
    };
    if (!item.createdAt) item.createdAt = new Date().toISOString();
    
    const res = await put(USERS_TABLE, item);
    if (!res.success) {
        throw new Error(`Failed to save user: ${res.error?.message || 'Unknown error'}`);
    }
    return res;
}

/**
 * Retrieves a user by their ID.
 */
async function getUserById(userId) {
    const res = await get(USERS_TABLE, { userId },{consistentRead:true});
    if (!res.success) {
        throw new Error(`Failed to get user: ${res.error?.message || 'Unknown error'}`);
    }
    return res.data || null;
}

/**
 * Updates a user's active resume reference.
 */
async function setActiveResumeId(userId, resumeId) {
    const res = await update(
        USERS_TABLE,
        { userId },
        'SET activeResumeId = :rid, updatedAt = :ua',
        { ':rid': resumeId, ':ua': new Date().toISOString() }
    );
    if (!res.success) {
        throw new Error(`Failed to update active resume: ${res.error?.message || 'Unknown error'}`);
    }
    return res.data;
}

/**
 * Stores the user's most recent job-description match analysis so the JD
 * interview module can load it at session init without re-scraping.
 */
async function saveJdAnalysis(userId, analysis) {
    const res = await update(
        USERS_TABLE,
        { userId },
        'SET latestJdAnalysis = :jd',
        { ':jd': { ...analysis, analyzedAt: new Date().toISOString() } }
    );
    if (!res.success) {
        throw new Error(`Failed to save JD analysis: ${res.error?.message || 'Unknown error'}`);
    }
    return res.data;
}

/**
 * Caches the most recent successfully validated website scrape so the
 * WEBSITE module's session init can reuse it instead of scraping the same
 * URL twice back-to-back (which hit rate limits and the init Lambda's
 * timeout — the 'Could not read that website' failure right after a
 * successful validation).
 */
async function saveWebsiteScrape(userId, scrape) {
    const res = await update(
        USERS_TABLE,
        { userId },
        'SET latestWebsiteScrape = :ws',
        { ':ws': { ...scrape, scrapedAt: new Date().toISOString() } }
    );
    if (!res.success) {
        throw new Error(`Failed to cache website scrape: ${res.error?.message || 'Unknown error'}`);
    }
    return res.data;
}

/**
 * Removes the user's stored FCM registration token.
 *
 * BE-BUG #18 FIX: the feedback notifier detected stale tokens
 * (`messaging/registration-token-not-registered`) but never removed them, so a
 * dead token lingered and every future feedback push wasted an FCM call. It is
 * also called on logout/account-switch so a signed-out device stops receiving
 * pushes.
 *
 * When {ifMatches} is supplied the removal is CONDITIONAL on the stored token
 * still equalling it — this avoids a race where a newer token was uploaded
 * (token refresh, or account B signing in on the same device) between the
 * failed send and this cleanup: we must not wipe the fresh token. A
 * ConditionalCheckFailed is treated as a successful no-op.
 */
async function clearFcmToken(userId, { ifMatches } = {}) {
    const values = { ':ua': new Date().toISOString() };
    const options = {};
    if (ifMatches) {
        values[':stale'] = ifMatches;
        options.condition = 'fcmToken = :stale';
    }
    const res = await update(
        USERS_TABLE,
        { userId },
        'SET updatedAt = :ua REMOVE fcmToken',
        values,
        null,
        options
    );
    if (!res.success && res.error?.name === 'ConditionalCheckFailedException') {
        // The token was already rotated — nothing to clean up.
        return { success: true, skipped: true };
    }
    if (!res.success) {
        throw new Error(`Failed to clear FCM token: ${res.error?.message || 'Unknown error'}`);
    }
    return res;
}

/**
 * Atomically marks a profile as DELETING before an account teardown begins
 * (R-03). This tombstone is the admission gate the paid/stateful entry points
 * read via assertAccountActive(user): once set, new interview sessions and
 * resume-processing jobs are rejected so a concurrent request cannot keep
 * spending or writing rows while the wipe is in flight.
 *
 * `deletionStartedAt` is only stamped once (if_not_exists) so a retry preserves
 * the original timestamp. The write is conditional on the profile still
 * existing: if a prior run already removed the identity, there is nothing to
 * tombstone and the subsequent idempotent wipe can proceed, so a
 * ConditionalCheckFailed is reported as a successful no-op rather than an error.
 */
async function beginAccountDeletion(userId) {
    const now = new Date().toISOString();
    const res = await update(
        USERS_TABLE,
        { userId },
        'SET accountStatus = :deleting, deletionStartedAt = if_not_exists(deletionStartedAt, :now), updatedAt = :now',
        { ':deleting': 'DELETING', ':now': now },
        null,
        { condition: 'attribute_exists(userId)', allowDeletion: true }
    );
    if (!res.success && res.error?.name === 'ConditionalCheckFailedException') {
        return { success: true, skipped: true };
    }
    if (!res.success) {
        throw new Error(`Failed to begin account deletion: ${res.error?.message || 'Unknown error'}`);
    }
    return { success: true };
}

module.exports = {
    saveUser,
    getUserById,
    setActiveResumeId,
    saveJdAnalysis,
    saveWebsiteScrape,
    clearFcmToken,
    beginAccountDeletion
};
