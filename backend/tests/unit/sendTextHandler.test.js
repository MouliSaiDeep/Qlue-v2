const { handler } = require('../../src/handlers/websocket/sendTextHandler');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { getLatestTranscripts } = require('../../src/models/transcript');
const { postToConnection } = require('../../src/lib/websocket');
const { docClient } = require('../../src/lib/dynamodb');
const { getConnection } = require('../../src/models/wsConnection');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { mockClient } = require('aws-sdk-client-mock');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript');
jest.mock('../../src/models/wsConnection');
jest.mock('../../src/lib/websocket');
jest.mock('../../src/lib/dynamodb');

const sqsMock = mockClient(SQSClient);

describe('sendTextHandler', () => {
    const connectionId = 'conn-123';
    const userId = 'user-123';
    const sessionId = 'session-123';

    beforeEach(() => {
        jest.clearAllMocks();
        sqsMock.reset();
        process.env.ASYNC_QUEUE_URL = 'https://sqs.queue.url';
        process.env.WS_CONNECTIONS_TABLE = 'qlue-connections';
        // The identity for every $default message comes from the connection
        // record written by $connect after verifying the Firebase token —
        // never from the message body.
        getConnection.mockResolvedValue({ connectionId, userId, isActive: 'true' });
    });

    it('rejects messages from a connection that is not registered', async () => {
        getConnection.mockResolvedValue(null);
        postToConnection.mockResolvedValue(true);

        const result = await handler({
            requestContext: { connectionId },
            body: JSON.stringify({ type: 'ping' })
        });

        expect(result.statusCode).toBe(401);
        expect(getSessionById).not.toHaveBeenCalled();
    });

    it('ignores a spoofed userId in the message body', async () => {
        getSessionById.mockResolvedValue({ sessionId, userId: 'victim-user' });
        postToConnection.mockResolvedValue(true);

        await handler({
            requestContext: { connectionId },
            body: JSON.stringify({
                type: 'session_init',
                userId: 'victim-user',
                payload: { sessionId }
            })
        });

        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ code: 403 })
        }));
        expect(sqsMock.calls()).toHaveLength(0);
    });

    it('rejects session_reconnect for a session owned by another user', async () => {
        getSessionById.mockResolvedValue({ sessionId, userId: 'other-user' });
        postToConnection.mockResolvedValue(true);

        await handler({
            requestContext: { connectionId },
            body: JSON.stringify({ type: 'session_reconnect', payload: { sessionId } })
        });

        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ code: 403 })
        }));
    });

    it('should handle ping and update heartbeat', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({ type: 'ping' })
        };

        docClient.send.mockResolvedValue({});
        postToConnection.mockResolvedValue(true);

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(docClient.send).toHaveBeenCalled();
        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({ type: 'pong' }));
    });

    it('should handle session_init successfully', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'session_init',
                payload: { sessionId, voiceId: 'Tiffany' }
            })
        };

        getSessionById.mockResolvedValue({ sessionId, userId, voiceId: 'Tiffany' });
        docClient.send.mockResolvedValue({});
        sqsMock.on(SendMessageCommand).resolves({});

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(sqsMock.calls()).toHaveLength(1);
        const sqsCall = JSON.parse(sqsMock.call(0).args[0].input.MessageBody);
        expect(sqsCall.action).toBe('session_init');
        expect(sqsCall.sessionId).toBe(sessionId);
    });

    it('should return 403 on session_init if user does not own session', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'session_init',
                payload: { sessionId }
            })
        };

        getSessionById.mockResolvedValue({ sessionId, userId: 'other-user' });
        postToConnection.mockResolvedValue(true);

        await handler(event);

        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ code: 403 })
        }));
    });

    it('should handle turn_submit successfully', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'turn_submit',
                payload: { sessionId, textTranscript: 'Hello' }
            })
        };

        getSessionById.mockResolvedValue({
            sessionId,
            userId,
            currentState: INTERVIEW_STATES.USER_RESPONDING,
            turnCount: 5
        });
        updateSessionState.mockResolvedValue({});
        sqsMock.on(SendMessageCommand).resolves({});

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(updateSessionState).toHaveBeenCalledWith(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.USER_RESPONDING);
        expect(sqsMock.calls()).toHaveLength(1);
    });

    it('should block turn_submit if session is in wrong state', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'turn_submit',
                payload: { sessionId, textTranscript: 'Hello' }
            })
        };

        getSessionById.mockResolvedValue({
            sessionId,
            userId,
            currentState: INTERVIEW_STATES.PROCESSING_RESPONSE
        });
        postToConnection.mockResolvedValue(true);

        await handler(event);

        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ code: 409 })
        }));
    });

    it('should handle session_reconnect successfully', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'session_reconnect',
                payload: { sessionId }
            })
        };

        getSessionById.mockResolvedValue({
            sessionId,
            userId,
            currentState: INTERVIEW_STATES.USER_RESPONDING,
            questionText: 'Tell me about yourself'
        });
        getLatestTranscripts.mockResolvedValue([{ speaker: 'AI', turnIndex: 2 }]);
        docClient.send.mockResolvedValue({});
        postToConnection.mockResolvedValue(true);

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_complete',
            payload: expect.objectContaining({
                questionText: 'Tell me about yourself',
                turnIndex: 2
            })
        }));
    });
});
