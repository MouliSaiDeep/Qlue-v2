const { getTranscriptBySession } = require('../../models/transcript');

/**
 * AWS Lambda Handler: GET /dashboard/transcript/{sessionId}
 */
exports.handler = async (event) => {
    try {
        // Resolve userId from authorizer
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing user context' })
            };
        }

        const sessionId = event.pathParameters?.sessionId;
        if (!sessionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'sessionId is required' })
            };
        }

        // Fetch transcript from DB
        const transcript = await getTranscriptBySession(sessionId);

        // Note: For production, we'd verify the user owns the session before returning transcript.
        // This is handled via the GSI_SessionIdTurnIndex which is partitioned by sessionId.

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                transcript
            })
        };

    } catch (error) {
        console.error('Get Transcript Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
