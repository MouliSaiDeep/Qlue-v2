const { get, put, update, query, delete: remove } = require('../lib/dynamodb');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';

/**
 * Creates a new resume record.
 */
async function createResume(resumeData) {
    const item = {
        ...resumeData,
        status: resumeData.status || 'PENDING',
        uploadedAt: Date.now(),
        isActive: false
    };
    return await put(RESUMES_TABLE, item);
}

/**
 * Retrieves a resume by ID.
 */
async function getResumeById(resumeId) {
    const res = await get(RESUMES_TABLE, { resumeId });
    return res.data || null;
}

/**
 * Lists all resumes for a specific user, newest first.
 */
async function getResumesByUserId(userId) {
    const options = {
        index: 'GSI_UserIdUploadedAt',
        values: { ':uid': userId },
        scanIndexForward: false
    };
    const res = await query(RESUMES_TABLE, 'userId = :uid', options);
    return res.data || [];
}

/**
 * Updates resume status and parsed data.
 */
async function updateResumeParsingResult(resumeId, status, parsedData = null, failReason = null) {
    let updateExp = 'SET #st = :status, updatedAt = :ua';
    const values = { 
        ':status': status,
        ':ua': new Date().toISOString()
    };
    const names = { '#st': 'status' };

    if (parsedData) {
        updateExp += ', parsedData = :pd, parsedAt = :pa';
        values[':pd'] = parsedData;
        values[':pa'] = Date.now();
    }
    if (failReason) {
        updateExp += ', failReason = :fr';
        values[':fr'] = failReason;
    }

    return await update(RESUMES_TABLE, { resumeId }, updateExp, values, names);
}

/**
 * Deletes a resume record.
 */
async function deleteResumeRecord(resumeId) {
    return await remove(RESUMES_TABLE, { resumeId });
}

module.exports = {
    createResume,
    getResumeById,
    getResumesByUserId,
    updateResumeParsingResult,
    deleteResumeRecord
};
