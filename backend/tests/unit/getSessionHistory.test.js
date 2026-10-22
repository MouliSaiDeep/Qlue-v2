const {mockClient}=require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {handler}=require('../../src/handlers/dashboard/getSessionHistory');
const db=mockClient(DynamoDBDocumentClient);
const event={requestContext:{authorizer:{uid:'owner'}}};
beforeEach(()=>db.reset());

test('history hides discarded and zero-answer sessions, retaining real zero-score and legacy sessions',async()=>{
  db.on(QueryCommand).resolves({Items:[
    {sessionId:'empty',discarded:true,feedbackExpected:false,answeredCount:0},
    {sessionId:'stale',answeredCount:0,accumulatedScores:{Clarity:99}},
    {sessionId:'answered',answeredCount:1,assessmentOverallScore:0},
    {sessionId:'ungraded-answer',answeredCount:1,feedbackExpected:false},
    {sessionId:'legacy'},
  ]});
  const response=await handler(event);
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).sessions.map(s=>s.sessionId)).toEqual(['answered','ungraded-answer','legacy']);
});

test('a page containing only abandoned interviews retains its continuation cursor',async()=>{
  const key={sessionId:'empty',userId:'owner',startedAt:123};
  db.on(QueryCommand).resolves({Items:[{sessionId:'empty',discarded:true,feedbackExpected:false,answeredCount:0}],LastEvaluatedKey:key});
  const first=JSON.parse((await handler(event)).body);
  expect(first.sessions).toEqual([]);
  expect(first.nextCursor).toEqual(expect.any(String));
  db.on(QueryCommand).resolves({Items:[{sessionId:'older-answer',answeredCount:1}]});
  const next=JSON.parse((await handler({...event,queryStringParameters:{cursor:first.nextCursor}})).body);
  expect(next.sessions.map(s=>s.sessionId)).toEqual(['older-answer']);
  expect(db.commandCalls(QueryCommand).at(-1).args[0].input.ExclusiveStartKey).toEqual(key);
});
