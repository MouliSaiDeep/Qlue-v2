const { getResumeById, getResumesByUserId } = require('../../models/resume');
const { setActiveResumeId } = require('../../models/user');
const { update } = require('../../lib/dynamodb');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';

/**
 * AWS Lambda Handler: POST /resume/active
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing user context' })
            };
        }

        const body = JSON.parse(event.body || '{}');
        const { resumeId } = body;
        if (!resumeId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'resumeId is required' })
            };
        }

        // 1. Verify existence and ownership
        const targetResume = await getResumeById(resumeId);
        if (!targetResume || targetResume.userId !== userId) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'NOT_FOUND', message: 'Resume not found' })
            };
        }

        // 2. Update status across all resumes for this user
        const resumes = await getResumesByUserId(userId);
        const updatePromises = resumes.map(r => {
            const shouldBeActive = r.resumeId === resumeId;
            if (r.isActive !== shouldBeActive) {
                return update(RESUMES_TABLE, { resumeId: r.resumeId }, 'SET isActive = :ia', { ':ia': shouldBeActive });
            }
        }).filter(Boolean);

        await Promise.all(updatePromises);

        // 3. Update the User profile record
        await setActiveResumeId(userId, resumeId);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Active resume updated successfully' })
        };

    } catch (error) {
        console.error('Set Active Resume Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
