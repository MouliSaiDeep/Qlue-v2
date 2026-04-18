const { getResumesByUserId } = require('../../models/resume');
const { success, unauthorized, badRequest, internalError } = require('../../lib/response');

/**
 * AWS Lambda Handler: POST /resume/validate-hash
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return unauthorized('Missing user context');
        }

        const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
        const { fileHash } = body;
        if (!fileHash) {
            return badRequest('fileHash is required');
        }

        const resumes = await getResumesByUserId(userId);
        const duplicate = resumes.find(item => item.fileHash === fileHash);

        return success({
            isDuplicate: !!duplicate,
            existingResumeId: duplicate ? duplicate.resumeId : null,
            existingFileName: duplicate ? duplicate.fileName : null,
            uploadedAt: duplicate ? duplicate.uploadedAt : null
        });

    } catch (error) {
        console.error('Validate Resume Hash Error:', error);
        return internalError(error.message);
    }
};
