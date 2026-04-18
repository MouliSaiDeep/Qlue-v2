const { getResumeById, updateResumeParsingResult } = require('../../models/resume');
const { update } = require('../../lib/dynamodb');
const { success, unauthorized, badRequest, notFound, internalError } = require('../../lib/response');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';

/**
 * AWS Lambda Handler: PATCH /resume/{resumeId}/data
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return unauthorized('Missing user context');
        }

        const resumeId = event.queryStringParameters?.resumeId;
        if (!resumeId) {
            return badRequest('resumeId is required');
        }

        const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
        const { updates } = body;
        if (!updates || typeof updates !== 'object') {
            return badRequest('No valid updates provided');
        }

        // Verify ownership and status
        const resume = await getResumeById(resumeId);
        if (!resume || resume.userId !== userId) {
            return notFound('Resume not found');
        }

        if (resume.status !== 'PARSED') {
            return badRequest('Only fully parsed resumes can be updated', 'INVALID_STATE');
        }

        // Merge updates into parsedData
        const newParsedData = {
            ...(resume.parsedData || {}),
            ...updates
        };

        const result = await updateResumeParsingResult(resumeId, 'PARSED', newParsedData);

        if (!result.success) {
            return internalError(result.error?.message, 'UPDATE_FAILED');
        }

        return success({
            message: 'Resume data updated successfully',
            resume: result.data
        });

    } catch (error) {
        console.error('Update Resume Data Error:', error);
        return internalError(error.message);
    }
};
