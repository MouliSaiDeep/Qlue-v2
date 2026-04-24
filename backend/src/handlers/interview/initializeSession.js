const { createSession, getActiveSessionForUser, INTERVIEW_STATES } = require('../../models/session');
const { getUserById } = require('../../models/user');
const { randomUUID } = require('crypto');

exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        // Custom Authorizer returns claims in authorizer object directly (uid or principalId)
        const authorizer = event.requestContext?.authorizer;
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub || body.userId;
        const moduleType = body.moduleType || 'RESUME';

        if (!userId) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized. User ID required.' }) };
        }

        // [Mouli Week 4: Voice Selection] Fetch user's preferred voice
        console.debug(`Fetching user profile for ${userId}...`);
        const user = await getUserById(userId);
        const voiceId = user?.voiceId || 'Tiffany';

        // [Mouli Week 4: Concurrency Lock]
        console.debug(`Checking for active sessions for ${userId}...`);
        const activeSession = await getActiveSessionForUser(userId);
        if (activeSession) {
            console.warn(`Concurrent session detected for ${userId}: ${activeSession.sessionId}`);
            return {
                statusCode: 409,
                body: JSON.stringify({
                    error: 'ConcurrentSessionError',
                    message: 'User already has an active interview session.',
                    activeSessionId: activeSession.sessionId
                })
            };
        }

        const sessionId = randomUUID();
        const itemData = { voiceId };
        if (body.resumeId) itemData.resumeId = body.resumeId;
        if (body.websiteUrl) itemData.websiteUrl = body.websiteUrl;

        console.info(`Creating new session ${sessionId} for ${userId} (Module: ${moduleType})`);
        await createSession(sessionId, userId, moduleType, itemData);


        // WEBSOCKET_ENDPOINT is set by SAM template as https://... but frontend needs wss://
        const wsHttpEndpoint = process.env.WEBSOCKET_ENDPOINT || '';
        const wsUrl = wsHttpEndpoint.replace('https://', 'wss://');

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                state: INTERVIEW_STATES.INITIALIZING,
                wsUrl,
            })
        };
    } catch (err) {
        console.error('Initialization Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
