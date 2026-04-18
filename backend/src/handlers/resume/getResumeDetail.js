const { getResumeById } = require('../../models/resume');
const { success, unauthorized, badRequest, notFound, internalError } = require('../../lib/response');

/**
 * AWS Lambda Handler: GET /resume/{resumeId}
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

        const resume = await getResumeById(resumeId);

        if (!resume || resume.userId !== userId) {
            return notFound('Resume not found');
        }

        return success({ resume });

    } catch (error) {
        console.error('Get Resume Detail Error:', error);
        return internalError(error.message);
    }
};
