const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
jest.mock('../../src/models/transcript', () => ({ getTranscriptBySession: jest.fn(async () => []) }));
const summary = require('../../src/handlers/dashboard/getDashboardSummary').handler;
const stats = require('../../src/handlers/dashboard/getModuleStats').handler;
const trends = require('../../src/handlers/dashboard/getScoreTrends').handler;
const detail = require('../../src/handlers/dashboard/getSessionDetail').handler;
const db = mockClient(DynamoDBDocumentClient);
const event = { requestContext: { authorizer: { uid: 'owner' } } };
beforeEach(() => db.reset());

test('trends deployment permits querying the exact session index it reads',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const template=require('../../../audit/read-cfn.cjs')(fs.readFileSync(path.resolve(__dirname,'../../template.yaml'),'utf8'));
 const statements=template.Resources.GetScoreTrendsFunction.Properties.Policies.flatMap(p=>p.Statement||[]);
 expect(statements).toContainEqual({Effect:'Allow',Action:['dynamodb:Query'],Resource:{'Fn::Sub':'${SessionsTable.Arn}/index/GSI_UserIdStartedAt'}});
});

test('explicitly empty sessions cannot affect totals, averages, best scores, radar or trends', async () => {
  const common = { userId: 'owner', moduleType: 'HR', startedAt: Date.now() };
  db.on(QueryCommand).resolves({ Items: [
    { ...common, sessionId: 'empty-stale', answeredCount: 0, accumulatedScores: { Clarity: 99 }, assessmentOverallScore: 99 },
    { ...common, sessionId: 'discarded', discarded: true, accumulatedScores: { Clarity: 99 } },
    { ...common, sessionId: 'answered-zero', answeredCount: 1, accumulatedScores: { Clarity: 0 }, assessmentOverallScore: 0 },
    { ...common, sessionId: 'legacy', accumulatedScores: { Clarity: 50 } }
  ] });
  db.on(GetCommand).resolves({});
  expect(JSON.parse((await summary(event)).body).summary).toMatchObject({
    totalSessions: 2, completedSessions: 2, averageScore: 25, bestScore: 50, moduleBreakdown: { HR: 2 }
  });
  expect(JSON.parse((await stats(event)).body).radarData.HR).toEqual({ Clarity: 25 });
  expect(JSON.parse((await trends(event)).body).trends.map(s => s.sessionId)).toEqual(['answered-zero', 'legacy']);
});

test.each([{ answeredCount: 0 }, { discarded: true }, { feedbackExpected: false }])(
  'owned session detail cannot resurrect a stale report for %j', async empty => {
    const session = { sessionId: 's', userId: 'owner', feedbackId: 'old-report', ...empty };
    db.on(GetCommand).callsFake(input => ({ Item: input.Key.sessionId ? session : {
      sessionId: 's', userId: 'owner', feedbackId: 'old-report', overallScore: 99
    } }));
    const response = await detail({ ...event, pathParameters: { sessionId: 's' } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ session, feedback: null, transcript: [] });
    expect(db.commandCalls(GetCommand)).toHaveLength(1);
  });
