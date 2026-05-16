const connect = require('../../src/handlers/websocket/connectHandler');
const disconnect = require('../../src/handlers/websocket/disconnectHandler');
const { verifyIdToken } = require('../../src/lib/firebase');
const { saveConnection, deactivateConnection, getActiveConnectionByUserId, getConnection } = require('../../src/models/wsConnection');
const { getSession, updateSessionState, INTERVIEW_STATES, getActiveSessionForUser } = require('../../src/models/session');
const { postToConnection } = require('../../src/lib/websocket');

jest.mock('../../src/lib/firebase');
jest.mock('../../src/models/wsConnection');
jest.mock('../../src/models/session');
jest.mock('../../src/lib/websocket');

describe('WebSocket Lifecycle', () => {
    const connectionId = 'conn-123';
    const userId = 'user-123';
    const token = 'valid-token';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('$connect handler', () => {
        it('should connect successfully with valid token', async () => {
            const event = {
                requestContext: { connectionId },
                queryStringParameters: { token }
            };

            verifyIdToken.mockResolvedValue({ uid: userId });
            getActiveConnectionByUserId.mockResolvedValue(null);
            saveConnection.mockResolvedValue({});

            const result = await connect.handler(event);

            expect(result.statusCode).toBe(200);
            expect(saveConnection).toHaveBeenCalledWith(connectionId, userId);
        });

        it('should return 401 if token is missing', async () => {
            const event = {
                requestContext: { connectionId },
                queryStringParameters: {}
            };

            const result = await connect.handler(event);
            expect(result.statusCode).toBe(401);
        });

        it('should notify and deactivate old connection on reconnection', async () => {
            const event = {
                requestContext: { connectionId },
                queryStringParameters: { token }
            };

            verifyIdToken.mockResolvedValue({ uid: userId });
            getActiveConnectionByUserId.mockResolvedValue({ connectionId: 'old-conn', userId });
            postToConnection.mockResolvedValue(true);
            deactivateConnection.mockResolvedValue({});
            saveConnection.mockResolvedValue({});

            const result = await connect.handler(event);

            expect(result.statusCode).toBe(200);
            expect(postToConnection).toHaveBeenCalledWith('old-conn', expect.objectContaining({
                type: 'error',
                payload: expect.objectContaining({ errorCode: 'RECONNECTED_ELSEWHERE' })
            }));
            expect(deactivateConnection).toHaveBeenCalledWith('old-conn', expect.anything());
        });
    });

    describe('$disconnect handler', () => {
        it('should deactivate connection', async () => {
            const event = { requestContext: { connectionId } };
            getConnection.mockResolvedValue({ connectionId, userId });
            getActiveSessionForUser.mockResolvedValue(null);
            deactivateConnection.mockResolvedValue({});

            const result = await disconnect.handler(event);

            expect(result.statusCode).toBe(200);
            expect(deactivateConnection).toHaveBeenCalledWith(connectionId);
        });

        it('should recover stranded session on disconnect', async () => {
            const event = { requestContext: { connectionId } };
            const sessionId = 'session-123';
            
            getConnection.mockResolvedValue({ connectionId, userId, sessionId });
            getSession.mockResolvedValue({
                sessionId,
                currentState: INTERVIEW_STATES.AI_SPEAKING
            });
            updateSessionState.mockResolvedValue({});

            const result = await disconnect.handler(event);

            expect(result.statusCode).toBe(200);
            expect(updateSessionState).toHaveBeenCalledWith(
                sessionId,
                INTERVIEW_STATES.USER_RESPONDING,
                INTERVIEW_STATES.AI_SPEAKING,
                expect.any(Object)
            );
        });
    });
});
