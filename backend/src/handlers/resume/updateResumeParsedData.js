const { getResumeById, updateResumeParsingResult } = require('../../models/resume');
const { update } = require('../../lib/dynamodb');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';

/**
 * AWS Lambda Handler: PATCH /resume/{resumeId}/data
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

        const resumeId = event.pathParameters?.resumeId;
        if (!resumeId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'resumeId is required' })
            };
        }

        const body = JSON.parse(event.body || '{}');
        const { updates } = body;
        if (!updates || typeof updates !== 'object') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'No valid updates provided' })
            };
        }

        // Verify ownership and status
        const resume = await getResumeById(resumeId);
        if (!resume || resume.userId !== userId) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'NOT_FOUND', message: 'Resume not found' })
            };
        }

        if (resume.status !== 'PARSED') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'INVALID_STATE', message: 'Only fully parsed resumes can be updated' })
            };
        }

        // Merge updates into parsedData
        const newParsedData = {
            ...(resume.parsedData || {}),
            ...updates
        };

        const result = await updateResumeParsingResult(resumeId, 'PARSED', newParsedData);

        if (!result.success) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'UPDATE_FAILED', details: result.error?.message })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Resume data updated successfully',
                resume: result.data
            })
        };

    } catch (error) {
        console.error('Update Resume Data Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
