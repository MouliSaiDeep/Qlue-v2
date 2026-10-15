const { mockClient: mockAdmissionClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient: AdmissionClient, GetCommand: AdmissionGet } = require('@aws-sdk/lib-dynamodb');
const admissionBoundary = mockAdmissionClient(AdmissionClient);
beforeEach(() => { admissionBoundary.reset(); admissionBoundary.on(AdmissionGet).resolves({}); });
const { handler } = require('../../src/handlers/interview/asyncWorker');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { postToConnection } = require('../../src/lib/websocket');

jest.mock('../../src/models/session');
jest.mock('../../src/lib/websocket');
jest.mock('../../src/handlers/interview/generateQuestion');
jest.mock('../../src/lib/polly');

const conditionalError = () => {
    const e = new Error('The conditional request failed');
    e.name = 'ConditionalCheckFailedException';
    return e;
};

describe('asyncWorker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should skip processing if session is not found', async () => {
        getSessionById.mockResolvedValue(null);

        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        sessionId: 'non-existent',
                        action: 'session_init'
                    })
                }
            ]
        };

        await handler(event);

        expect(getSessionById).toHaveBeenCalledWith('non-existent');
        expect(postToConnection).not.toHaveBeenCalled();
    });

    test('should skip processing if session is in terminal state', async () => {
        getSessionById.mockResolvedValue({
            sessionId: 'session-123',
            currentState: 'TERMINATED'
        });

        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        sessionId: 'session-123',
                        action: 'turn_submit'
                    })
                }
            ]
        };

        await handler(event);

        expect(getSessionById).toHaveBeenCalledWith('session-123');
        expect(postToConnection).not.toHaveBeenCalled();
    });

    // ---- Finding 5 regressions ----

    test('two workers cannot commit the same turn: a duplicate delivery fails the atomic claim and is skipped', async () => {
        getSessionById.mockResolvedValue({
            sessionId: 'session-123',
            userId: 'u',
            currentState: INTERVIEW_STATES.PROCESSING_RESPONSE,
            turnCount: 0,
            moduleType: 'HR'
        });
        // The claim (PROCESSING_RESPONSE -> LOADING_CONTEXT) loses because a
        // sibling worker already advanced the state.
        updateSessionState.mockRejectedValue(conditionalError());

        const event = {
            Records: [{
                body: JSON.stringify({
                    connectionId: 'c',
                    sessionId: 'session-123',
                    action: 'turn_submit',
                    expectedTurnCount: 0
                })
            }]
        };

        await handler(event);

        expect(updateSessionState).toHaveBeenCalledWith(
            'session-123',
            INTERVIEW_STATES.LOADING_CONTEXT,
            INTERVIEW_STATES.PROCESSING_RESPONSE,
            expect.objectContaining({ expectedTurnCount: 0 }) // + I-04 lease stamp
        );
        // Claim failed -> continue: no paid work, no client message.
        expect(postToConnection).not.toHaveBeenCalled();
    });

    test('termination during generation stays terminated: error recovery never revives a terminal session', async () => {
        getSessionById
            .mockResolvedValueOnce({
                sessionId: 'session-123',
                userId: 'u',
                currentState: INTERVIEW_STATES.PROCESSING_RESPONSE,
                turnCount: 0
            })
            // catch-block re-fetch: a concurrent terminate has finished.
            .mockResolvedValueOnce({
                sessionId: 'session-123',
                currentState: INTERVIEW_STATES.TERMINATED
            });
        // The claim throws a non-conditional error, dropping into the catch.
        updateSessionState.mockRejectedValueOnce(new Error('dynamo blip'));
        postToConnection.mockResolvedValue(true);

        const event = {
            Records: [{
                body: JSON.stringify({
                    connectionId: 'c',
                    sessionId: 'session-123',
                    action: 'turn_submit',
                    expectedTurnCount: 0
                })
            }]
        };

        await handler(event);

        // Must tell the client the session ended, and must NOT write
        // USER_RESPONDING (which would resurrect a terminated interview).
        expect(postToConnection).toHaveBeenCalledWith('c', expect.objectContaining({
            type: 'termination'
        }));
        expect(updateSessionState).not.toHaveBeenCalledWith(
            'session-123',
            INTERVIEW_STATES.USER_RESPONDING,
            expect.anything()
        );
        expect(postToConnection).not.toHaveBeenCalledWith('c', expect.objectContaining({
            type: 'turn_error'
        }));
    });

    test('a failed claim leaves the durable job for retry and does not release another worker', async () => {
        getSessionById
            .mockResolvedValueOnce({
                sessionId: 'session-123',
                userId: 'u',
                currentState: INTERVIEW_STATES.PROCESSING_RESPONSE,
                turnCount: 0
            })
            // catch-block re-fetch: still an in-flight, non-terminal state.
            .mockResolvedValueOnce({
                sessionId: 'session-123',
                currentState: INTERVIEW_STATES.PROCESSING_RESPONSE
            });
        updateSessionState
            .mockRejectedValueOnce(new Error('dynamo blip'))  // the claim
            .mockResolvedValueOnce({});                        // the conditional release
        postToConnection.mockResolvedValue(true);

        const event = {
            Records: [{
                body: JSON.stringify({
                    connectionId: 'c',
                    sessionId: 'session-123',
                    action: 'turn_submit',
                    expectedTurnCount: 0
                })
            }]
        };

        await handler(event);

        expect(updateSessionState).toHaveBeenCalledTimes(1);
        expect(updateSessionState).toHaveBeenCalledWith('session-123',INTERVIEW_STATES.LOADING_CONTEXT,INTERVIEW_STATES.PROCESSING_RESPONSE,expect.objectContaining({leaseOwner:expect.any(String)}));
        expect(postToConnection).toHaveBeenCalledWith('c', expect.objectContaining({
            type: 'turn_error',
            payload: expect.objectContaining({ retryable: true, terminal: false })
        }));
    });
});
