const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require("aws-sdk-client-mock");
const { handler } = require('../../src/handlers/dashboard/getDashboardSummary');

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('getDashboardSummary handler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('should return 401 if userId is missing', async () => {
    const event = {
      requestContext: { authorizer: {} }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it('should calculate dashboard summary correctly', async () => {
    const userId = 'user123';
    const event = {
      requestContext: { authorizer: { uid: userId } }
    };

    const mockSessions = [
      { userId, moduleType: 'RESUME', accumulatedScores: { technical: 80, communication: 90 } },
      { userId, moduleType: 'HR', accumulatedScores: { culture: 70 } }
    ];
    const mockFeedback = [
      { userId, strengths: ['Java'], weaknesses: ['Python'], executiveSummary: 'Good' }
    ];

    ddbMock.on(QueryCommand, { TableName: 'qlue-sessions' }).resolves({
      Items: mockSessions
    });

    ddbMock.on(QueryCommand, { TableName: 'qlue-feedback' }).resolves({
      Items: mockFeedback
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.userId).toBe(userId);
    expect(body.summary.totalSessions).toBe(2);
    expect(body.summary.completedSessions).toBe(2);
    // (85 + 70) / 2 = 77.5 -> 78
    expect(body.summary.averageScore).toBe(78);
    expect(body.summary.bestScore).toBe(85);
    expect(body.summary.latestFeedback.strengths).toEqual(['Java']);
  });

  it('should return 500 on error', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'user123' } }
    };

    ddbMock.on(QueryCommand).rejects(new Error('DDB error'));

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });
});
