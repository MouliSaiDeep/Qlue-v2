const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');
const { handler: stats } = require('../../src/handlers/dashboard/getModuleStats');
const { handler: trends } = require('../../src/handlers/dashboard/getScoreTrends');

const ddb = mockClient(DynamoDBDocumentClient);
const event = { requestContext: { authorizer: { uid: 'synthetic-user' } }, queryStringParameters: { period: 'all' } };
const rows = [
  { sessionId: 's1', userId: 'synthetic-user', startedAt: 1000, moduleType: 'HR', accumulatedScores: { Clarity: 80 }, assessmentOverallScore: 85, answeredCount: 1 },
  { sessionId: 's2', userId: 'synthetic-user', startedAt: 2000, moduleType: 'HR', accumulatedScores: { Clarity: 0 }, answeredCount: 1 },
  { sessionId: 'empty', moduleType: 'HR', accumulatedScores: { Clarity: 100 }, answeredCount: 0 },
  { sessionId: 'discarded', moduleType: 'HR', accumulatedScores: { Clarity: 100 }, discarded: true },
  { sessionId: 'no-feedback', moduleType: 'HR', accumulatedScores: { Clarity: 100 }, feedbackExpected: false },
];

afterAll(() => ddb.restore());
beforeEach(() => ddb.reset());

test.each([
  ['stats', stats, ['moduleType', 'accumulatedScores', 'discarded', 'answeredCount', 'feedbackExpected']],
  ['trends', trends, ['sessionId', 'startTime', 'startedAt', 'moduleType', 'accumulatedScores', 'assessmentOverallScore', 'discarded', 'answeredCount', 'feedbackExpected']],
])('%s projects only required fields without changing page count or ownership', async (name, handler, fields) => {
  const key = { userId: 'synthetic-user', sessionId: 's2', startedAt: 2000 };
  ddb.on(QueryCommand).callsFake(input => {
    expect(input.ProjectionExpression.split(',').map(x => x.trim()).sort()).toEqual([...fields].sort());
    expect(input.IndexName).toBe('GSI_UserIdStartedAt');
    expect(input.KeyConditionExpression).toBe('userId = :uid');
    expect(input.ExpressionAttributeValues).toEqual({ ':uid': 'synthetic-user' });
    // Emulate actual DynamoDB projection, rather than returning hidden fields.
    const selected = input.ExclusiveStartKey ? rows.slice(2) : rows.slice(0, 2);
    return {
      Items: selected.map(row => Object.fromEntries(Object.entries(row).filter(([field]) => fields.includes(field)))),
      ...(input.ExclusiveStartKey ? {} : { LastEvaluatedKey: key }),
    };
  });
  const response = await handler(event);
  expect(response.statusCode).toBe(200);
  expect(ddb.commandCalls(QueryCommand)).toHaveLength(2);
  expect(ddb.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(key);
  const body = JSON.parse(response.body);
  if (name === 'stats') {
    expect(body.radarData.HR).toEqual({ Clarity: 40 });
    expect(body.radarData.OVERALL).toEqual({ Clarity: 40 });
  } else {
    expect(body.trends).toEqual([
      { sessionId: 's1', date: '1970-01-01T00:00:01.000Z', moduleType: 'HR', score: 85 },
      { sessionId: 's2', date: '1970-01-01T00:00:02.000Z', moduleType: 'HR', score: 0 },
    ]);
  }
});

test.each([stats, trends])('unauthenticated aggregates do not query DynamoDB', async handler => {
  expect((await handler({ requestContext: { authorizer: {} } })).statusCode).toBe(401);
  expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
});
