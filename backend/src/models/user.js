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

module.exports = {
    saveUser,
    getUserById,
    setActiveResumeId
};
