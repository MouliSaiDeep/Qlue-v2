const { createSession } = require('../../models/session');
const { transitionState, INTERVIEW_STATES } = require('./controlTurnFlow');
const crypto = require('crypto');
const generateQuestion = require('./generateQuestion');

/**
 * Initializes a new interview session.
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        // JWT context is assumed on API Gateway
        const userId = event.requestContext?.authorizer?.claims?.sub || body.userId || 'anonymous';
        const moduleType = body.moduleType || 'RESUME';
        const resumeId = body.resumeId;

        if (!['RESUME', 'WEBSITE', 'HR'].includes(moduleType)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: `Invalid moduleType: ${moduleType}` })
            };
        }

        const sessionId = crypto.randomUUID();

        // 1. Create Session
        const session = await createSession(sessionId, userId, moduleType);

        // 2. Transition immediately to LOADING_CONTEXT
        await transitionState(sessionId, INTERVIEW_STATES.LOADING_CONTEXT);

        // 3. Generate the First Question immediately
        const firstQuestionEvent = {
            body: JSON.stringify({
                sessionId,
                resumeId, // TBL-002 lookup will happen inside generateQuestion
                moduleType,
                topic: body.topic,
                currentConceptId: body.currentConceptId,
                contentSnippet: body.contentSnippet
            })
        };
        
        // Simulating direct synchronous trigger; in production, this could be SNS/SQS or async Invoke.
        const generatedResponse = await generateQuestion.handler(firstQuestionEvent);
        const parsedData = JSON.parse(generatedResponse.body);

        // 4. Resolve Initialization Sequence
        // Flutter connects via WS_ENDPOINT to establish the streaming link.
        const wsEndpoint = process.env.WS_ENDPOINT || 'wss://qlue-ws-api.aws.random-stub.com/dev';

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                moduleType,
                state: INTERVIEW_STATES.LOADING_CONTEXT,
                firstQuestion: parsedData.aiResponse,
                websocketUrl: `${wsEndpoint}?sessionId=${sessionId}`,
                message: 'Session initialized. Connect to WebSocket.'
            })
        };
    } catch (err) {
        console.error('Failed to initialize session:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};
