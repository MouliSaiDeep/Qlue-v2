const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getSession, INTERVIEW_STATES, updateSessionState } = require('../../models/session');
const { postToConnection } = require('../../lib/websocket');
const { associateSession } = require('../../models/wsConnection');
const terminateSession = require('../interview/terminateSession');

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const QUEUE_URL = process.env.ASYNC_QUEUE_URL;

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body || '{}');
    const type = body.type;

    console.info(`Received WS message [${type}] from connection ${connectionId}`);

    try {
        switch (type) {
            case 'session_init':
            case 'turn_submit':
                return await dispatchToSQS(connectionId, body);
            
            case 'session_reconnect':
                return await handleSessionReconnect(connectionId, body);
            
            case 'terminate_session':
                return await handleTerminateSession(connectionId, body);
            
            case 'ping':
                await postToConnection(connectionId, { type: 'pong' });
                return { statusCode: 200 };
            
            default:
                console.warn(`Unhandled message type: ${type}`);
                return { statusCode: 200 };
        }
    } catch (error) {
        console.error('WebSocket dispatch failed:', error);
        await postToConnection(connectionId, {
            type: 'turn_error',
            payload: { message: 'Failed to process message', code: 'DISPATCH_ERROR' }
        }).catch(() => {});
        return { statusCode: 500 };
    }
};

async function dispatchToSQS(connectionId, body) {
    const { sessionId } = body.payload || {};
    if (!sessionId) throw new Error('Missing sessionId');

    const session = await getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const command = new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
            type: body.type,
            connectionId,
            sessionId,
            expectedVersion: session.version,
            text: body.payload.text,
            isSilence: body.payload.isSilence === true,
            currentConceptId: body.payload.currentConceptId,
            moduleType: body.payload.moduleType,
            voiceId: body.payload.voiceId,
            engine: body.payload.engine
        })
    });

    await sqs.send(command);
    return { statusCode: 200 };
}

async function handleSessionReconnect(connectionId, body) {
    const { sessionId } = body.payload || {};
    if (!sessionId) throw new Error('Missing sessionId');

    await associateSession(connectionId, sessionId);
    const session = await getSession(sessionId);
    if (!session) {
        await postToConnection(connectionId, {
            type: 'turn_error',
            payload: { sessionId, message: 'Session not found', code: 'SESSION_NOT_FOUND' }
        });
        return { statusCode: 200 };
    }

    if (session.currentState === INTERVIEW_STATES.TERMINATED || session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
        await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
        return { statusCode: 200 };
    }

    if (session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE || session.currentState === INTERVIEW_STATES.AI_SPEAKING) {
        const now = Date.now();
        const lastUpdate = session.updatedAt ? new Date(session.updatedAt).getTime() : now;
        const diffSeconds = (now - lastUpdate) / 1000;

        if (diffSeconds > 30 && session.questionText) {
            await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, session.currentState);
            await postToConnection(connectionId, {
                type: 'turn_complete',
                payload: {
                    sessionId,
                    turnIndex: session.turnCount,
                    questionText: session.questionText,
                    audioData: '',
                    currentConceptId: session.currentConceptId,
                    state: 'USER_RESPONDING',
                    timestamp: Date.now()
                }
            });
        } else {
            await postToConnection(connectionId, {
                type: 'turn_error',
                payload: { sessionId, message: 'Still generating, please wait', code: 'STILL_PROCESSING', recoverable: true }
            });
        }
        return { statusCode: 200 };
    }

    if (session.currentState === INTERVIEW_STATES.USER_RESPONDING && session.questionText) {
        await postToConnection(connectionId, {
            type: 'turn_complete',
            payload: {
                sessionId,
                turnIndex: session.turnCount,
                questionText: session.questionText,
                audioData: '',
                currentConceptId: session.currentConceptId,
                state: 'USER_RESPONDING',
                timestamp: Date.now()
            }
        });
        return { statusCode: 200 };
    }

    await postToConnection(connectionId, {
        type: 'turn_complete',
        payload: {
            sessionId,
            turnIndex: session.turnCount,
            questionText: session.questionText || 'Welcome back. Please respond when ready.',
            audioData: '',
            currentConceptId: session.currentConceptId,
            state: 'USER_RESPONDING',
            timestamp: Date.now()
        }
    });
    return { statusCode: 200 };
}

async function handleTerminateSession(connectionId, body) {
    const { sessionId } = body.payload || {};
    await terminateSession.handler({
        body: JSON.stringify({ sessionId, reason: 'USER_INITIATED' })
    });
    await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
    return { statusCode: 200 };
}
