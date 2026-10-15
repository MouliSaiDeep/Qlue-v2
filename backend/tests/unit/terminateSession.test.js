const { handler } = require('../../src/handlers/interview/terminateSession');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { mockClient } = require('aws-sdk-client-mock');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript');
const { getTranscriptBySession } = require('../../src/models/transcript');
const snsMock = mockClient(SNSClient);

describe('terminateSession handler', () => {
    const userId = 'test-user-123';
    const sessionId = 'test-session-456';
    const FEEDBACK_TOPIC_ARN = 'arn:aws:sns:region:account:feedback-topic';

    beforeEach(() => {
        jest.clearAllMocks();
        snsMock.reset();
        process.env.FEEDBACK_TOPIC_ARN = FEEDBACK_TOPIC_ARN;
        getTranscriptBySession.mockResolvedValue([
            { speaker: 'USER', text: 'Hello, here is my response.' }
        ]);
    });

    it('should return 400 if sessionId is missing', async () => {
        const event = { body: JSON.stringify({}) };
        const result = await handler(event);
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toBe('sessionId required');
    });

    it('should return 404 if session is not found', async () => {
        getSessionById.mockResolvedValue(null);
        const event = { body: JSON.stringify({ sessionId }) };
        const result = await handler(event);
        expect(result.statusCode).toBe(404);
    });

    it('should return 403 if user does not own the session', async () => {
        getSessionById.mockResolvedValue({ userId: 'other-user', sessionId });
        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId })
        };
        const result = await handler(event);
        expect(result.statusCode).toBe(403);
    });

    it('should return 200 and "Already terminated" if session is already terminated', async () => {
        getSessionById.mockResolvedValue({ userId, sessionId, currentState: INTERVIEW_STATES.TERMINATED });
        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId })
        };
        const result = await handler(event);
        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body).message).toBe('Already terminated');
    });

    it('should successfully terminate session and trigger SNS', async () => {
        getSessionById.mockResolvedValue({
            userId,
            sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR'
        });
        updateSessionState.mockResolvedValue({});
        snsMock.on(PublishCommand).resolves({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(updateSessionState).toHaveBeenCalledWith(
            sessionId,
            INTERVIEW_STATES.GENERATING_FEEDBACK,
            INTERVIEW_STATES.AI_SPEAKING,
            expect.objectContaining({ terminationReason: 'USER_QUIT' })
        );
        expect(updateSessionState).toHaveBeenCalledWith(
            sessionId,
            INTERVIEW_STATES.TERMINATED,
            INTERVIEW_STATES.GENERATING_FEEDBACK,expect.objectContaining({expectedFeedbackAttemptId:expect.any(String)})
        );

        expect(snsMock.calls()).toHaveLength(1);
        const snsCall = snsMock.call(0).args[0].input;
        expect(snsCall.TopicArn).toBe(FEEDBACK_TOPIC_ARN);
        expect(JSON.parse(snsCall.Message)).toEqual({ attemptId:`initial-${sessionId}`,
            sessionId,
            userId,
            moduleType: 'HR',
            reason: 'USER_QUIT'
        });
    });

    it('should handle ConditionalCheckFailedException during state update gracefully', async () => {
        getSessionById.mockResolvedValue({
            userId,
            sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR'
        });

        // First update succeeds
        updateSessionState.mockResolvedValueOnce({});
        // Second update fails with conditional check
        const conditionalError = new Error('Conditional check failed');
        conditionalError.name = 'ConditionalCheckFailedException';
        updateSessionState.mockRejectedValueOnce(conditionalError);
        getSessionById.mockResolvedValueOnce({userId,sessionId,moduleType:'HR',currentState:INTERVIEW_STATES.AI_SPEAKING})
          .mockResolvedValue({userId,sessionId,moduleType:'HR',currentState:INTERVIEW_STATES.GENERATING_FEEDBACK});

        snsMock.on(PublishCommand).resolves({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId })
        };

        const result = await handler(event);
        expect(result.statusCode).toBe(200); // Still returns 200 because it was likely already moved to TERMINATED
    });

    it('should discard empty session if no user answers', async () => {
        getSessionById.mockResolvedValue({
            userId,
            sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR'
        });
        getTranscriptBySession.mockResolvedValue([]); // No transcripts / no user answers
        updateSessionState.mockResolvedValue({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);
        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body).discarded).toBe(true);
        expect(updateSessionState).toHaveBeenCalledWith(
            sessionId,
            INTERVIEW_STATES.TERMINATED,
            INTERVIEW_STATES.AI_SPEAKING,
            expect.objectContaining({ discarded: true, terminationReason: 'USER_QUIT' })
        );
    });

    // ---- Finding 5 regressions ----

    it('is idempotent while feedback is already generating: no second SNS publish', async () => {
        // The app fires both a WS terminate_session and a REST terminate on end,
        // and generateAtomicTurn can auto-terminate. A terminate that arrives
        // after the session already entered the feedback pipeline must be a
        // no-op success, never a duplicate feedback job.
        getSessionById.mockResolvedValue({
            userId,
            sessionId,
            currentState: INTERVIEW_STATES.GENERATING_FEEDBACK,
            moduleType: 'HR'
        });
        snsMock.on(PublishCommand).resolves({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body).message).toBe('Feedback already in progress');
        expect(updateSessionState).not.toHaveBeenCalled();
        expect(snsMock.calls()).toHaveLength(0);
    });

    it('loses the feedback claim to a concurrent terminate and does not publish twice', async () => {
        // Two terminate paths observe the same live state and both try to claim
        // the feedback pipeline. The conditional GENERATING_FEEDBACK write is the
        // referee: the loser gets ConditionalCheckFailedException and returns an
        // idempotent 200 WITHOUT publishing a second SNS feedback job.
        getSessionById.mockResolvedValue({
            userId,
            sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR'
        });
        const conditionalError = new Error('The conditional request failed');
        conditionalError.name = 'ConditionalCheckFailedException';
        updateSessionState.mockRejectedValueOnce(conditionalError);
        getSessionById.mockResolvedValueOnce({userId,sessionId,moduleType:'HR',currentState:INTERVIEW_STATES.AI_SPEAKING})
          .mockResolvedValue({userId,sessionId,moduleType:'HR',currentState:INTERVIEW_STATES.GENERATING_FEEDBACK});
        snsMock.on(PublishCommand).resolves({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(updateSessionState).toHaveBeenCalledWith(
            sessionId,
            INTERVIEW_STATES.GENERATING_FEEDBACK,
            INTERVIEW_STATES.AI_SPEAKING,
            expect.objectContaining({ terminationReason: 'USER_QUIT' })
        );
        expect(snsMock.calls()).toHaveLength(0);
    });

    // ---- I-08: discard-empty uses the DURABLE answeredCount, not the GSI ----
    //
    // The app fires BOTH a WebSocket and a REST terminate on end, so a freshly
    // answered session was read back with an empty (lagging) transcripts GSI and
    // WRONGLY discarded as "empty", losing the whole interview. The decision now
    // trusts the strongly-consistent answeredCount on the session row, falling
    // back to the GSI only for legacy sessions that never recorded it.

    it('does NOT discard a freshly-answered session when the GSI still lags (answeredCount > 0 wins)', async () => {
        getSessionById.mockResolvedValue({
            userId, sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR',
            answeredCount: 1          // a real answer was accepted...
        });
        getTranscriptBySession.mockResolvedValue([]); // ...but the GSI has not caught up
        updateSessionState.mockResolvedValue({});
        snsMock.on(PublishCommand).resolves({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body).discarded).toBeUndefined(); // NOT discarded
        // It entered the feedback pipeline instead of being thrown away...
        expect(updateSessionState).toHaveBeenCalledWith(
            sessionId,
            INTERVIEW_STATES.GENERATING_FEEDBACK,
            INTERVIEW_STATES.AI_SPEAKING,
            expect.objectContaining({ terminationReason: 'USER_QUIT' })
        );
        // ...and the lagging GSI was never consulted (durable count is authoritative).
        expect(getTranscriptBySession).not.toHaveBeenCalled();
    });

    it('treats a numeric answeredCount of 0 as authoritative and discards without the GSI', async () => {
        // Defensive: when the durable count is present it is authoritative even at
        // 0 — the GSI must not be able to re-open a session the count says is empty.
        getSessionById.mockResolvedValue({
            userId, sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR',
            answeredCount: 0
        });
        getTranscriptBySession.mockResolvedValue([{ speaker: 'USER', text: 'stray index row' }]);
        updateSessionState.mockResolvedValue({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);

        expect(JSON.parse(result.body).discarded).toBe(true);
        expect(getTranscriptBySession).not.toHaveBeenCalled();
    });

    it('falls back to the GSI for a legacy session with no answeredCount (empty -> discard)', async () => {
        getSessionById.mockResolvedValue({
            userId, sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR'
            // no answeredCount: created before I-08
        });
        getTranscriptBySession.mockResolvedValue([]);
        updateSessionState.mockResolvedValue({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);

        expect(JSON.parse(result.body).discarded).toBe(true);
        expect(getTranscriptBySession).toHaveBeenCalledWith(sessionId); // full legacy transcript fallback used
    });

    it('falls back to the GSI for a legacy session and proceeds when the GSI shows an answer', async () => {
        getSessionById.mockResolvedValue({
            userId, sessionId,
            currentState: INTERVIEW_STATES.AI_SPEAKING,
            moduleType: 'HR'
        });
        getTranscriptBySession.mockResolvedValue([{ speaker: 'USER', text: 'A real answer.' }]);
        updateSessionState.mockResolvedValue({});
        snsMock.on(PublishCommand).resolves({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId, reason: 'USER_QUIT' })
        };

        const result = await handler(event);

        expect(JSON.parse(result.body).discarded).toBeUndefined();
        expect(getTranscriptBySession).toHaveBeenCalled();
    });
});
