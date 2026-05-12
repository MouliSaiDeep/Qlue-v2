const { handler } = require('../../src/handlers/interview/terminateSession');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { mockClient } = require('aws-sdk-client-mock');

jest.mock('../../src/models/session');
const snsMock = mockClient(SNSClient);

describe('terminateSession handler', () => {
    const userId = 'test-user-123';
    const sessionId = 'test-session-456';
    const FEEDBACK_TOPIC_ARN = 'arn:aws:sns:region:account:feedback-topic';

    beforeEach(() => {
        jest.clearAllMocks();
        snsMock.reset();
        process.env.FEEDBACK_TOPIC_ARN = FEEDBACK_TOPIC_ARN;
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
            null,
            expect.objectContaining({ terminationReason: 'USER_QUIT' })
        );
        expect(updateSessionState).toHaveBeenCalledWith(
            sessionId,
            INTERVIEW_STATES.TERMINATED,
            INTERVIEW_STATES.GENERATING_FEEDBACK
        );
        
        expect(snsMock.calls()).toHaveLength(1);
        const snsCall = snsMock.call(0).args[0].input;
        expect(snsCall.TopicArn).toBe(FEEDBACK_TOPIC_ARN);
        expect(JSON.parse(snsCall.Message)).toEqual({
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
        
        snsMock.on(PublishCommand).resolves({});

        const event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ sessionId })
        };

        const result = await handler(event);
        expect(result.statusCode).toBe(200); // Still returns 200 because it was likely already moved to TERMINATED
    });
});
