const { handler } = require('../../src/handlers/dashboard/getDashboardSummary');

// Use virtual mocks because the dependencies might not be installed in the environment
jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn()
}), { virtual: true });

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn().mockReturnValue({
            send: jest.fn()
        })
    },
    QueryCommand: jest.fn().mockImplementation((args) => args)
}), { virtual: true });

const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

describe('getDashboardSummary baseline', () => {
    let mockSend;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSend = DynamoDBDocumentClient.from().send;
    });

    it('should return dashboard summary correctly', async () => {
        const userId = 'user123';
        const mockSessions = [
            { userId, moduleType: 'RESUME', accumulatedScores: { technical: 80, communication: 90 } },
            { userId, moduleType: 'HR', accumulatedScores: { culture: 70 } }
        ];
        const mockFeedback = [
            { userId, strengths: ['Java'], weaknesses: ['Python'], executiveSummary: 'Good' }
        ];

        mockSend.mockImplementation(async (command) => {
            if (command.IndexName === 'UserIdIndex') {
                return { Items: mockSessions };
            }
            if (command.IndexName === 'GSI_UserIdGeneratedAt') {
                return { Items: mockFeedback };
            }
            return { Items: [] };
        });

        const event = {
            requestContext: {
                authorizer: {
                    uid: userId
                }
            }
        };

        const result = await handler(event);
        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body.userId).toBe(userId);
        expect(body.summary.totalSessions).toBe(2);
        expect(body.summary.completedSessions).toBe(2);
        expect(body.summary.averageScore).toBe(78);
        expect(body.summary.bestScore).toBe(85);
        expect(body.summary.latestFeedback.strengths).toEqual(['Java']);
    });

    it('should handle unauthorized requests', async () => {
        const event = {
            requestContext: {}
        };

        const result = await handler(event);
        expect(result.statusCode).toBe(401);
    });
});
