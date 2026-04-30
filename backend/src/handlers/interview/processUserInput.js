const { processUserTurn } = require('../../services/interviewService');

/**
 * HTTP wrapper for turn processing.
 * Most logic has been moved to interviewService.js and asyncWorker.js.
 */
exports.handler = async (event) => {
    const body = JSON.parse(event.body || '{}');
    const { sessionId, text, isSilence, currentConceptId } = body;

    if (!sessionId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Missing sessionId' }),
            headers: { 'Access-Control-Allow-Origin': '*' }
        };
    }

    try {
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
