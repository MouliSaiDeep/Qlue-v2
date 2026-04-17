const { getResumeById } = require('../../models/resume');

/**
 * AWS Lambda Handler: GET /resume/{resumeId}
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

        const resume = await getResumeById(resumeId);

        if (!resume || resume.userId !== userId) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'NOT_FOUND', message: 'Resume not found' })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ resume })
        };

    } catch (error) {
        console.error('Get Resume Detail Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
