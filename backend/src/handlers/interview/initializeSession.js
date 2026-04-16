const { createSession, getActiveSessionForUser, INTERVIEW_STATES } = require('../../models/session');
const { v4: uuidv4 } = require('uuid');

exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const userId = event.requestContext?.authorizer?.claims?.sub || body.userId;
        const moduleType = body.moduleType || 'RESUME';

        if (!userId) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized. User ID required.' }) };
        }

        // [Mouli Week 4: Concurrency Lock]
        const activeSession = await getActiveSessionForUser(userId);
        if (activeSession) {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    error: 'ConcurrentSessionError',
                    message: 'User already has an active interview session.',
                    activeSessionId: activeSession.sessionId
                })
            };
        }

        const sessionId = uuidv4();
        await createSession(sessionId, userId, moduleType);

        // Hypothetically, Nithin's logic here triggers the first prompt.
        const wsEndpoint = process.env.WS_ENDPOINT || 'wss://fake.qlue.aws';

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                state: INTERVIEW_STATES.INITIALIZING,
                websocketUrl: `${wsEndpoint}?sessionId=${sessionId}`
            })
        };
    } catch (err) {
        console.error('Initialization Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
