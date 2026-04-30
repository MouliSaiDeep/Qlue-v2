const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getSession, INTERVIEW_STATES } = require('../../models/session');
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
            case 'text_transcript':
            case 'silence_detected':
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
            type: 'error',
            payload: { message: 'Failed to process message' }
        }).catch(() => {});
        return { statusCode: 500 };
    }
};

async function dispatchToSQS(connectionId, body) {
    const { sessionId } = body.payload || {};
    if (!sessionId) throw new Error('Missing sessionId');

    const command = new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
            type: body.type,
            connectionId,
            sessionId,
            text: body.payload.text,
            isSilence: body.type === 'silence_detected',
            moduleType: body.payload.moduleType
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
    
    if (session) {
        await postToConnection(connectionId, {
            type: 'session_state_update',
            payload: { state: session.currentState, turnCount: session.turnCount, questionText: session.questionText }
        });
    }
    
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
