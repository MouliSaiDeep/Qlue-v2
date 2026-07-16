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
    const res = await get(USERS_TABLE, { userId });
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

module.exports = {
    saveUser,
    getUserById,
    setActiveResumeId,
    saveJdAnalysis,
    saveWebsiteScrape
};
