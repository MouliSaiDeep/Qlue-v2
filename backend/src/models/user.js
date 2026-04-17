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
    
    return await put(USERS_TABLE, item);
}

/**
 * Retrieves a user by their ID.
 */
async function getUserById(userId) {
    const res = await get(USERS_TABLE, { userId });
    return res.data || null;
}

/**
 * Updates a user's active resume reference.
 */
async function setActiveResumeId(userId, resumeId) {
    return await update(
        USERS_TABLE,
        { userId },
        'SET activeResumeId = :rid, updatedAt = :ua',
        { ':rid': resumeId, ':ua': new Date().toISOString() }
    );
}

module.exports = {
    saveUser,
    getUserById,
    setActiveResumeId
};
