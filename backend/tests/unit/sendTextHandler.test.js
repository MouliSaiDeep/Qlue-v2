beforeEach(() => require('../../src/lib/dynamodb').docClient.send.mockResolvedValue({}));
const { handler } = require('../../src/handlers/websocket/sendTextHandler');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { getLatestTranscripts } = require('../../src/models/transcript');
const { postToConnection } = require('../../src/lib/websocket');
const { docClient, fencedSend } = require('../../src/lib/dynamodb');
const { getConnection } = require('../../src/models/wsConnection');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { mockClient } = require('aws-sdk-client-mock');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript', () => ({...jest.requireActual('../../src/models/transcript'), saveTranscript:jest.fn(),getContextWindow:jest.fn(),getLatestTranscripts:jest.fn(),getTranscriptBySession:jest.fn()}));
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
        getConnection.mockResolvedValue({ connectionId, userId, isActive: 'true', emailVerified: true });
    });

    it('an old unverified socket cannot mutate sessions or enqueue paid work', async () => {
        getConnection.mockResolvedValue({connectionId,userId,isActive:'true',emailVerified:false});
        await handler({requestContext:{connectionId},body:JSON.stringify({type:'turn_submit',payload:{sessionId,textTranscript:'Complete answer'}})});
        expect(getSessionById).not.toHaveBeenCalled();expect(updateSessionState).not.toHaveBeenCalled();expect(sqsMock.calls()).toHaveLength(0);
    });

    it('accepts the actual APK payload with clientTurnId using the real receipt lookup', async () => {
        const clientTurnId = 'app-capture-1';
        getSessionById.mockResolvedValue({sessionId,userId,currentState:INTERVIEW_STATES.USER_RESPONDING,turnCount:1});
        docClient.send.mockResolvedValue({});
        sqsMock.on(SendMessageCommand).resolves({});
        await handler({requestContext:{connectionId},body:JSON.stringify({type:'turn_submit',payload:{sessionId,clientTurnId,textTranscript:'Complete answer',isSilence:false}})});
        expect(updateSessionState).toHaveBeenCalledWith(sessionId,INTERVIEW_STATES.PROCESSING_RESPONSE,INTERVIEW_STATES.USER_RESPONDING,expect.objectContaining({clientTurnId}));
        expect(sqsMock.calls()).toHaveLength(1);
        expect(postToConnection).toHaveBeenCalledWith(connectionId,expect.objectContaining({type:'turn_ack',payload:expect.objectContaining({clientTurnId,accepted:true})}));
        expect(postToConnection.mock.calls.some(([,frame])=>frame.type==='turn_error')).toBe(false);
    });

    it('reconnect before initial socket delivery enqueues the opener instead of fabricating a question', async () => {
        getSessionById.mockResolvedValue({sessionId,userId,currentState:INTERVIEW_STATES.INITIALIZING,turnCount:0});
        docClient.send.mockResolvedValue({});sqsMock.on(SendMessageCommand).resolves({});
        await handler({requestContext:{connectionId},body:JSON.stringify({type:'session_reconnect',payload:{sessionId}})});
        expect(sqsMock.calls()).toHaveLength(1);
        expect(JSON.parse(sqsMock.call(0).args[0].input.MessageBody)).toMatchObject({sessionId,action:'session_init'});
        expect(postToConnection.mock.calls.some(([,frame])=>frame.type==='turn_complete')).toBe(false);
    });

    it('reconnect to ERROR returns a terminal stopped response, never a fabricated question', async () => {
        getSessionById.mockResolvedValue({sessionId,userId,currentState:INTERVIEW_STATES.ERROR,turnCount:1,errorMessage:'TURN_RECOVERY_EXHAUSTED'});
        getLatestTranscripts.mockResolvedValue([]);
        await handler({requestContext:{connectionId},body:JSON.stringify({type:'session_reconnect',payload:{sessionId}})});
        expect(postToConnection).toHaveBeenCalledWith(connectionId,expect.objectContaining({type:'turn_error',payload:expect.objectContaining({terminal:true})}));
        expect(postToConnection.mock.calls.some(([,frame])=>frame.type==='turn_complete')).toBe(false);
        expect(sqsMock.calls()).toHaveLength(0);
    });

    it('audio-only refresh uses the owned canonical object and does not enqueue or advance a turn', async () => {
        process.env.AUDIO_BUCKET='question-audio-test';
        process.env.AWS_ACCESS_KEY_ID='LOCAL_TEST_KEY';process.env.AWS_SECRET_ACCESS_KEY='LOCAL_TEST_SECRET';
        getSessionById.mockResolvedValue({sessionId,userId,currentState:INTERVIEW_STATES.USER_RESPONDING,lastTurnPayload:{turnId:'q',expectsAnswer:true,audioKey:`audio/${sessionId}/q.mp3`}});
        docClient.send.mockResolvedValue({});
        try {
            await handler({requestContext:{connectionId},body:JSON.stringify({type:'session_reconnect',payload:{sessionId,turnId:'q',audioOnly:true}})});
            expect(postToConnection).toHaveBeenCalledWith(connectionId,expect.objectContaining({type:'question_audio',payload:expect.objectContaining({turnId:'q',audioUrl:expect.stringContaining('q.mp3')})}));
            expect(sqsMock.calls()).toHaveLength(0);expect(updateSessionState).not.toHaveBeenCalled();
            expect(postToConnection.mock.calls.some(([,frame])=>frame.type==='turn_complete')).toBe(false);
        } finally {delete process.env.AUDIO_BUCKET;delete process.env.AWS_ACCESS_KEY_ID;delete process.env.AWS_SECRET_ACCESS_KEY;}
    });

    it('audio-only request cannot refresh another account’s audio', async () => {
        getSessionById.mockResolvedValue({sessionId,userId:'other',currentState:INTERVIEW_STATES.USER_RESPONDING});
        await handler({requestContext:{connectionId},body:JSON.stringify({type:'session_reconnect',payload:{sessionId,turnId:'q',audioOnly:true}})});
        expect(postToConnection).toHaveBeenCalledWith(connectionId,expect.objectContaining({type:'turn_error',payload:expect.objectContaining({code:403})}));
        expect(postToConnection.mock.calls.some(([,frame])=>frame.type==='question_audio')).toBe(false);
    });

    it('replays a committed receipt without sending the old answer as a new turn', async () => {
        const clientTurnId='already-accepted';
        const body={sessionId,clientTurnId,textTranscript:'Earlier answer',isSilence:false};
        const lastTurnPayload={sessionId,clientTurnId,turnId:'next-question',turnIndex:2,questionText:'Next question?'};
        getSessionById.mockResolvedValue({sessionId,userId,currentState:INTERVIEW_STATES.USER_RESPONDING,turnCount:2,lastTurnPayload});
        docClient.send.mockImplementation(async command=>command.input.Key?.transcriptId?{Item:{fingerprint:require('../../src/lib/turnReceipt').fingerprint(body),job:{expectedTurnCount:1}}}:{});
        await handler({requestContext:{connectionId},body:JSON.stringify({type:'turn_submit',payload:body})});
        expect(updateSessionState).not.toHaveBeenCalled();expect(sqsMock.calls()).toHaveLength(0);
        expect(postToConnection).toHaveBeenCalledWith(connectionId,{type:'turn_complete',payload:lastTurnPayload});
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
        expect(fencedSend).toHaveBeenCalled();
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
        expect(updateSessionState).toHaveBeenCalledWith(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.USER_RESPONDING, expect.objectContaining({pendingJob:expect.any(Object)}));
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

    // ---- Finding 5 regressions ----

    it('empty transcript does not mutate session state (validates before acquiring)', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'turn_submit',
                payload: { sessionId }  // no textTranscript, not marked silence
            })
        };
        postToConnection.mockResolvedValue(true);

        await handler(event);

        // Validation fails first: the session is never moved to
        // PROCESSING_RESPONSE and nothing is queued, so a bad payload can no
        // longer wedge the interview.
        expect(updateSessionState).not.toHaveBeenCalled();
        expect(getSessionById).not.toHaveBeenCalled();
        expect(sqsMock.calls()).toHaveLength(0);
        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ code: 400 })
        }));
    });

    it('accepts a silence turn with no transcript', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'turn_submit',
                payload: { sessionId, isSilence: true }
            })
        };
        getSessionById.mockResolvedValue({
            sessionId,
            userId,
            currentState: INTERVIEW_STATES.USER_RESPONDING,
            turnCount: 1
        });
        updateSessionState.mockResolvedValue({});
        sqsMock.on(SendMessageCommand).resolves({});

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(updateSessionState).toHaveBeenCalledWith(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.USER_RESPONDING, expect.objectContaining({pendingJob:expect.any(Object)}));
        expect(sqsMock.calls()).toHaveLength(1);
        const sqsCall = JSON.parse(sqsMock.call(0).args[0].input.MessageBody);
        expect(sqsCall.body.isSilence).toBe(true);
    });

    it('retains the durable pending job when enqueue fails so recovery can retry', async () => {
        const event = {
            requestContext: { connectionId, authorizer: { uid: userId } },
            body: JSON.stringify({
                type: 'turn_submit',
                payload: { sessionId, textTranscript: 'A real answer' }
            })
        };
        getSessionById.mockResolvedValue({
            sessionId,
            userId,
            currentState: INTERVIEW_STATES.USER_RESPONDING,
            turnCount: 2
        });
        updateSessionState.mockResolvedValue({});
        sqsMock.on(SendMessageCommand).rejects(new Error('simulated queue outage'));
        postToConnection.mockResolvedValue(true);

        await handler(event);

        // Acquire, then a conditional rollback to USER_RESPONDING so the client
        // can retry instead of being stranded in PROCESSING_RESPONSE forever.
        expect(updateSessionState).toHaveBeenCalledWith(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.USER_RESPONDING, expect.objectContaining({pendingJob:expect.any(Object)}));
        expect(updateSessionState).not.toHaveBeenCalledWith(sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.PROCESSING_RESPONSE);
        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ code: 503 })
        }));
    });

    it('recovers a genuinely stale in-flight lease on reconnect', async () => {
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
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            questionText: 'Q?',
            turnCount: 3,
            updatedAt: new Date(Date.now() - 60000).toISOString()  // 60s ago, stale
        });
        getLatestTranscripts.mockResolvedValue([{ speaker: 'AI', turnIndex: 2 }]);
        docClient.send.mockResolvedValue({});
        updateSessionState.mockResolvedValue({});
        postToConnection.mockResolvedValue(true);

        await handler(event);

        // Recovery is conditional on the observed state so a still-alive worker
        // wins the race.
        expect(updateSessionState).toHaveBeenCalledWith(sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.AI_SPEAKING);
        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_complete',
            payload: expect.objectContaining({ state: INTERVIEW_STATES.USER_RESPONDING })
        }));
    });

    it('does not duplicate the answer when reconnecting during a valid in-flight lease', async () => {
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
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            questionText: 'Q?',
            turnCount: 3,
            updatedAt: new Date().toISOString()  // fresh, NOT stale
        });
        getLatestTranscripts.mockResolvedValue([{ speaker: 'AI', turnIndex: 2 }]);
        docClient.send.mockResolvedValue({});
        postToConnection.mockResolvedValue(true);

        await handler(event);

        // A valid, still-running turn must NOT be reclaimed or replayed — just
        // acknowledged. Replaying USER_RESPONDING here duplicated the answer.
        expect(updateSessionState).toHaveBeenCalledWith(sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.AI_SPEAKING, {connectionId});
        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'reconnect_ack'
        }));
        expect(postToConnection).not.toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_complete'
        }));
    });

    // ---- R-10: a socket must not outlive the credential that opened it ----

    it('denies a mutation once the connection ttl (token-bound auth window) has elapsed', async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        // The row is still present (DynamoDB's TTL sweeper is best-effort), but
        // its token-bound auth window has already passed. The next mutation must
        // be refused so a revoked/expired credential's socket can't drive on.
        getConnection.mockResolvedValue({ connectionId, userId, isActive: 'true', emailVerified: true, ttl: nowSec - 1 });
        postToConnection.mockResolvedValue(true);

        const result = await handler({
            requestContext: { connectionId },
            body: JSON.stringify({ type: 'turn_submit', payload: { sessionId, textTranscript: 'Hello' } })
        });

        expect(result.statusCode).toBe(401);
        // No session work happens — the expired socket cannot read or drive it.
        expect(getSessionById).not.toHaveBeenCalled();
        expect(updateSessionState).not.toHaveBeenCalled();
        expect(sqsMock.calls()).toHaveLength(0);
        expect(postToConnection).toHaveBeenCalledWith(connectionId, expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ code: 401, error: expect.stringMatching(/expired/i) })
        }));
    });

    it('a heartbeat refresh must NOT extend the authorization ttl (no silent extension)', async () => {
        const event = {
            requestContext: { connectionId },
            body: JSON.stringify({ type: 'ping' })
        };
        docClient.send.mockResolvedValue({});
        postToConnection.mockResolvedValue(true);

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        // Every message-path write must touch liveness fields only. Writing ttl
        // here would let an open socket renew its own authorization window
        // indefinitely, defeating token revocation/expiry (R-10).
        const calls = fencedSend.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [command] of calls) {
            const input = command.input || {};
            expect(input.UpdateExpression || '').not.toMatch(/ttl/i);
            expect(input.ExpressionAttributeValues || {}).not.toHaveProperty(':ttl');
            expect(input.ExpressionAttributeNames || {}).not.toHaveProperty('#ttl');
        }
    });
});
