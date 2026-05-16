const { handler } = require('../../src/handlers/feedback/triggerFeedbackGeneration');
const ddb = require('../../src/lib/dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { mockClient } = require('aws-sdk-client-mock');

jest.mock('../../src/lib/dynamodb');
const lambdaMock = mockClient(LambdaClient);

describe('triggerFeedbackGeneration handler', () => {
    const ANALYZE_LAMBDA = 'arn:aws:lambda:region:account:function:analyzeTranscript';

    beforeEach(() => {
        jest.clearAllMocks();
        lambdaMock.reset();
        process.env.ANALYZE_TRANSCRIPT_LAMBDA = ANALYZE_LAMBDA;
    });

    it('should successfully trigger feedback generation', async () => {
        const sessionId = 'session-123';
        const userId = 'user-123';
        const moduleType = 'HR';

        const event = {
            Records: [{
                Sns: {
                    Message: JSON.stringify({ sessionId, userId, moduleType })
                }
            }]
        };

        const mockTranscripts = [
            { speaker: 'ai', text: 'Hello', turnIndex: 0, timestamp: '2026-05-12T10:00:00Z' },
            { speaker: 'user', text: 'Hi', turnIndex: 1, timestamp: '2026-05-12T10:00:05Z' }
        ];

        ddb.query.mockResolvedValue({ success: true, data: mockTranscripts });
        ddb.get.mockResolvedValue({ success: true, data: { accumulatedScores: { score: 100 } } });
        lambdaMock.on(InvokeCommand).resolves({});

        const result = await handler(event);

        expect(result.success).toBe(true);
        expect(ddb.query).toHaveBeenCalledWith(
            expect.any(String),
            'sessionId = :sid',
            expect.objectContaining({ values: { ':sid': sessionId } })
        );

        expect(lambdaMock.calls()).toHaveLength(1);
        const lambdaCall = lambdaMock.call(0).args[0].input;
        expect(lambdaCall.FunctionName).toBe(ANALYZE_LAMBDA);
        expect(lambdaCall.InvocationType).toBe('Event');
        
        const payload = JSON.parse(Buffer.from(lambdaCall.Payload).toString());
        expect(payload.sessionId).toBe(sessionId);
        expect(payload.transcript).toContain('AI: Hello');
        expect(payload.transcript).toContain('USER: Hi');
        expect(payload.accumulatedScores).toEqual({ score: 100 });
        expect(payload.metadata.turnCount).toBe(2);
    });

    it('should skip if required fields are missing in SNS message', async () => {
        const event = {
            Records: [{
                Sns: {
                    Message: JSON.stringify({ sessionId: '123' }) // missing userId, moduleType
                }
            }]
        };

        const result = await handler(event);
        expect(result.success).toBe(true);
        expect(ddb.query).not.toHaveBeenCalled();
    });

    it('should skip if no transcripts are found', async () => {
        const event = {
            Records: [{
                Sns: {
                    Message: JSON.stringify({ sessionId: '123', userId: '456', moduleType: 'HR' })
                }
            }]
        };

        ddb.query.mockResolvedValue({ success: true, data: [] });

        const result = await handler(event);
        expect(result.success).toBe(true);
        expect(lambdaMock.calls()).toHaveLength(0);
    });
});
