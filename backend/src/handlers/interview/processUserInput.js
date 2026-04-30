const { processUserTurn } = require('../../services/interviewService');

/**
 * HTTP wrapper for turn processing.
 * Most logic has been moved to interviewService.js and asyncWorker.js.
 */
exports.handler = async (event) => {
    const body = JSON.parse(event.body || '{}');
    const { sessionId, text, isSilence, currentConceptId } = body;

    // Extract authenticated user ID from authorizer context
    const authorizer = event.requestContext?.authorizer;
    const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;

    if (!sessionId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Missing sessionId' }),
            headers: { 'Access-Control-Allow-Origin': '*' }
        };
    }

    try {
        // Verify session ownership
        const { getSession } = require('../../models/session');
        const session = await getSession(sessionId);
        if (!session) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'Session not found' }),
                headers: { 'Access-Control-Allow-Origin': '*' }
            };
        }
        if (userId && session.userId !== userId) {
            return {
                statusCode: 403,
                body: JSON.stringify({ message: 'Not authorized for this session' }),
                headers: { 'Access-Control-Allow-Origin': '*' }
            };
        }
        const result = await processUserTurn(sessionId, text, isSilence, currentConceptId);
        
        return {
            statusCode: 200,
            body: JSON.stringify(result),
            headers: { 'Access-Control-Allow-Origin': '*' }
        };
    } catch (error) {
        console.error('[ProcessUserInput] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: error.message }),
            headers: { 'Access-Control-Allow-Origin': '*' }
        };
    }
};
