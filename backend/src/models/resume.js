const { docClient } = require('../lib/dynamodb');
const { PutCommand, UpdateCommand, GetCommand, QueryCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const CORE_TABLE = process.env.CORE_TABLE;

function getUserPk(userId) {
    return `USER#${userId}`;
}

/**
 * Creates a new resume record in the core table.
 * 
 * PK: USER#<userId>
 * SK: RESUME#<resumeId>
 */
async function createResume(resumeData) {
    const now = new Date().toISOString();
    const item = {
        ...resumeData,
        PK: getUserPk(resumeData.userId),
        SK: `RESUME#${resumeData.resumeId}`,
        entityType: 'RESUME',
        status: resumeData.status || 'PENDING',
        createdAt: now,
        updatedAt: now
    };

    await docClient.send(new PutCommand({
        TableName: CORE_TABLE,
        Item: item
    }));

    return { success: true };
}

/**
 * Retrieves a resume by ID.
 */
async function getResumeById(resumeId) {
    // Query using GSI1 if available, or scan across users
    const command = new QueryCommand({
        TableName: CORE_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `RESUME#${resumeId}` },
        Limit: 1
    });
    const res = await docClient.send(command);
    return (res.Items && res.Items.length > 0) ? res.Items[0] : null;
}

/**
 * Retrieves a specific resume using the composite key.
 */
async function getResumeByUserIdAndKey(userId, resumeId) {
    const command = new GetCommand({
        TableName: CORE_TABLE,
        Key: { PK: getUserPk(userId), SK: `RESUME#${resumeId}` }
    });
    const res = await docClient.send(command);
    return res.Item || null;
}

/**
 * Lists all resumes for a specific user, newest first.
 */
async function getResumesByUserId(userId) {
    const command = new QueryCommand({
        TableName: CORE_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': getUserPk(userId), ':prefix': 'RESUME#' },
        ScanIndexForward: false
    });
    const res = await docClient.send(command);
    return res.Items || [];
}

/**
 * Updates resume status and parsed data.
 */
async function updateResumeParsingResult(userId, resumeId, status, parsedData = null, failReason = null) {
    const now = new Date().toISOString();
    let updateExp = 'SET #st = :status, updatedAt = :ua';
    const values = { 
        ':status': status,
        ':ua': now
    };
    const names = { '#st': 'status' };

    if (parsedData) {
        updateExp += ', parsedData = :pd, parsedAt = :pa';
        values[':pd'] = parsedData;
        values[':pa'] = now;
    }
    if (failReason) {
        updateExp += ', failReason = :fr';
        values[':fr'] = failReason;
    }

    const res = await docClient.send(new UpdateCommand({
        TableName: CORE_TABLE,
        Key: { PK: getUserPk(userId), SK: `RESUME#${resumeId}` },
        UpdateExpression: updateExp,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames: names,
        ReturnValues: 'ALL_NEW'
    }));

    return { success: true, data: res.Attributes };
}

/**
 * Deletes a resume record.
 */
async function deleteResumeRecord(userId, resumeId) {
    await docClient.send(new DeleteCommand({
        TableName: CORE_TABLE,
        Key: { PK: getUserPk(userId), SK: `RESUME#${resumeId}` }
    }));
    return { success: true };
}

/**
 * Toggles the active status for a user's resumes.
 */
async function toggleActiveStatus(userId, activeResumeId) {
    const resumes = await getResumesByUserId(userId);
    
    const updatePromises = resumes.map(r => {
        const shouldBeActive = r.resumeId === activeResumeId;
        const resumeId = r.resumeId || r.SK.split('#')[1]; // Extract from SK if needed
        
        return docClient.send(new UpdateCommand({
            TableName: CORE_TABLE,
            Key: { PK: getUserPk(userId), SK: `RESUME#${resumeId}` },
            UpdateExpression: 'SET isActive = :ia, updatedAt = :ua',
            ExpressionAttributeValues: { 
                ':ia': shouldBeActive,
                ':ua': new Date().toISOString()
            }
        }));
    });
    
    await Promise.all(updatePromises);
}

/**
 * Retrieves the active resume for a user.
 */
async function getActiveResume(userId) {
    const resumes = await getResumesByUserId(userId);
    return resumes.find(r => r.isActive === true) || null;
}

module.exports = {
    createResume,
    getResumeById,
    getResumeByUserIdAndKey,
    getResumesByUserId,
    getActiveResume,
    updateResumeParsingResult,
    deleteResumeRecord,
    toggleActiveStatus
};
