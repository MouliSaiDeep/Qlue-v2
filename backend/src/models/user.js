const { docClient } = require('../lib/dynamodb');
const { PutCommand, UpdateCommand, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const CORE_TABLE = process.env.CORE_TABLE;
const USER_PROFILE_SK = 'PROFILE';

function getUserPk(userId) {
    return `USER#${userId}`;
}

/**
 * Creates or updates a user profile record in the core table.
 */
async function saveUser(user) {
    const now = new Date().toISOString();
    const item = {
        ...user,
        PK: getUserPk(user.userId),
        SK: USER_PROFILE_SK,
        entityType: 'USER',
        updatedAt: now
    };
    if (!item.createdAt) item.createdAt = now;

    await docClient.send(new PutCommand({
        TableName: CORE_TABLE,
        Item: item
    }));
    
    return { success: true };
}

/**
 * Retrieves a user by their ID from the core table.
 */
async function getUserById(userId) {
    const command = new GetCommand({
        TableName: CORE_TABLE,
        Key: { PK: getUserPk(userId), SK: USER_PROFILE_SK }
    });
    const res = await docClient.send(command);
    return res.Item || null;
}

/**
 * Updates a user's active resume reference.
 */
async function setActiveResumeId(userId, resumeId) {
    const now = new Date().toISOString();
    
    const res = await docClient.send(new UpdateCommand({
        TableName: CORE_TABLE,
        Key: { PK: getUserPk(userId), SK: USER_PROFILE_SK },
        UpdateExpression: 'SET activeResumeId = :rid, updatedAt = :ua',
        ExpressionAttributeValues: { ':rid': resumeId, ':ua': now },
        ReturnValues: 'ALL_NEW'
    }));

    return res.Attributes;
}

/**
 * Retrieves a user by their email.
 */
async function getUserByEmail(email) {
    const command = new QueryCommand({
        TableName: CORE_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `EMAIL#${email}` },
        Limit: 1
    });
    const res = await docClient.send(command);
    return (res.Items && res.Items.length > 0) ? res.Items[0] : null;
}

/**
 * Updates a user profile.
 */
async function updateUserProfile(userId, updates) {
    const now = new Date().toISOString();
    let updateExpression = 'SET updatedAt = :ua';
    const expressionAttributeValues = { ':ua': now };
    
    Object.keys(updates).forEach(key => {
        updateExpression += `, ${key} = :${key}`;
        expressionAttributeValues[`:${key}`] = updates[key];
    });

    const res = await docClient.send(new UpdateCommand({
        TableName: CORE_TABLE,
        Key: { PK: getUserPk(userId), SK: USER_PROFILE_SK },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW'
    }));

    return res.Attributes;
}

module.exports = {
    saveUser,
    getUserById,
    getUserByEmail,
    setActiveResumeId,
    updateUserProfile
};
