const { getResumeById, getResumesByUserId } = require('../../models/resume');
const { setActiveResumeId } = require('../../models/user');
const { update } = require('../../lib/dynamodb');
const { success, unauthorized, badRequest, notFound, internalError } = require('../../lib/response');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';

/**
 * AWS Lambda Handler: POST /resume/active
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return unauthorized('Missing user context');
        }

        const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
        const { resumeId } = body;
        if (!resumeId) {
            return badRequest('resumeId is required');
        }

        // 1. Verify existence and ownership
        const targetResume = await getResumeById(resumeId);
        if (!targetResume || targetResume.userId !== userId) {
            return notFound('Resume not found');
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

        return success({ message: 'Active resume updated successfully' });

    } catch (error) {
        console.error('Set Active Resume Error:', error);
        return internalError(error.message);
    }
};
