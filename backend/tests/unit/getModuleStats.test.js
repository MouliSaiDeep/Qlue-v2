const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require("aws-sdk-client-mock");
const { handler } = require('../../src/handlers/dashboard/getModuleStats');

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('getModuleStats handler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('should return 401 if userId is missing', async () => {
    const event = {
      requestContext: { authorizer: {} },
      queryStringParameters: {}
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it('should calculate module stats correctly', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } },
      queryStringParameters: { period: '7d' }
    };

    const mockSessions = [
      {
        moduleType: 'RESUME',
        accumulatedScores: {
          'Communication': 80,
          'Technical': 70
        },
        startedAt: Date.now()
      },
      {
        moduleType: 'RESUME',
        accumulatedScores: {
          'Communication': 90,
          'Technical': 80
        },
        startedAt: Date.now()
      },
      {
        moduleType: 'HR',
        accumulatedScores: {
          'Communication': 85,
          'SoftSkills': 75
        },
        startedAt: Date.now()
      }
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: mockSessions
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    
    // Resume average: Communication=(80+90)/2=85, Technical=(70+80)/2=75
    expect(body.radarData.RESUME.Communication).toBe(85);
    expect(body.radarData.RESUME.Technical).toBe(75);
    
    // HR average: Communication=85, SoftSkills=75
    expect(body.radarData.HR.Communication).toBe(85);
    expect(body.radarData.HR.SoftSkills).toBe(75);
    
    // Overall: 
    // Communication: (Resume:85 + HR:85)/2 = 85
    // Technical: (Resume:75)/1 = 75
    // SoftSkills: (HR:75)/1 = 75
    expect(body.radarData.OVERALL.Communication).toBe(85);
    expect(body.radarData.OVERALL.Technical).toBe(75);
    expect(body.radarData.OVERALL.SoftSkills).toBe(75);
  });

  it('should return 500 on error', async () => {
    const event = {
      requestContext: { authorizer: { uid: 'test-user-id' } }
    };

    ddbMock.on(QueryCommand).rejects(new Error('DDB error'));

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
  });
});
