const {mockClient}=require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
jest.mock('../../src/lib/bedrock',()=>({...jest.requireActual('../../src/lib/bedrock'),invokeModel:jest.fn()}));
const {invokeModel}=require('../../src/lib/bedrock');
const analyze=require('../../src/handlers/feedback/analyzeTranscript').handler;
const details=require('../../src/handlers/dashboard/getSessionDetail').handler;
const history=require('../../src/handlers/dashboard/getSessionHistory').handler;
const summary=require('../../src/handlers/dashboard/getDashboardSummary').handler;
const trends=require('../../src/handlers/dashboard/getScoreTrends').handler;
const attempt=require('../../src/lib/feedbackAttempt');
const {DocumentBoundary}=require('../helpers/documentBoundary');
const db=mockClient(DynamoDBDocumentClient),lambda=mockClient(LambdaClient);
const session={sessionId:'s',userId:'owner',moduleType:'INTRO',feedbackAttemptId:'current',answerIdentityVersion:1,acceptedAnswerIds:['a'],answeredCount:1};
const event={...session,attemptId:'current',answerPairs:[{answerId:'a',question:'Describe a project.',answer:'I built an API for practice.'}]};
const valid={content:[{text:JSON.stringify({coaching:require('../helpers/coachingFixture')('a',true),answers:[{answerId:'a',levels:[3,2,4,3],evidenceIds:Array(4).fill('e1')}]})}]};
beforeEach(()=>{
 db.reset();lambda.reset();invokeModel.mockReset();
 db.on(GetCommand).callsFake(input=>({Item:input.Key.sessionId?session:undefined}));
 lambda.on(InvokeCommand).resolves({});process.env.GENERATE_REPORT_LAMBDA='report';
});
const output=()=>JSON.parse(Buffer.from(lambda.commandCalls(InvokeCommand)[0].args[0].input.Payload).toString()).assessmentResult;
test('malformed result has one bounded retry and no hidden provider retries',async()=>{
 invokeModel.mockResolvedValueOnce({content:[{text:'bad JSON'}]}).mockResolvedValueOnce(valid);
 await analyze(event);expect(invokeModel).toHaveBeenCalledTimes(2);
 expect(invokeModel.mock.calls[0][2]).toMatchObject({retries:0});expect(output().overallScore).toBe(73.8);
});
test('exhausted malformed results become unavailable rather than fictitious marks',async()=>{
 invokeModel.mockResolvedValue({content:[{text:'{"Clarity":50}'}]});await analyze(event);
 expect(invokeModel).toHaveBeenCalledTimes(2);expect(output()).toMatchObject({analysisStatus:'UNAVAILABLE',overallScore:null,dimensionScores:{}});
});
test('insufficient evidence has no paid retry and a foreign answer manifest never reaches the model',async()=>{
 invokeModel.mockResolvedValue({content:[{text:'{"unavailable":true}'}]});await analyze(event);
 expect(invokeModel).toHaveBeenCalledTimes(1);expect(output().analysisStatus).toBe('UNAVAILABLE');
 invokeModel.mockClear();lambda.reset();lambda.on(InvokeCommand).resolves({});
 await analyze({...event,answerPairs:[{...event.answerPairs[0],answerId:'foreign'}]});expect(invokeModel).not.toHaveBeenCalled();
});
test('stale attempts cannot invoke a model or publish grades',async()=>{
 expect(await analyze({...event,attemptId:'stale'})).toEqual({success:true,stale:true});expect(invokeModel).not.toHaveBeenCalled();expect(lambda.calls()).toHaveLength(0);
});
test('unavailable assessment clears provisional scores without overlapping SET/REMOVE',async()=>{
 const boundary=new DocumentBoundary();boundary.seed('qlue-sessions',{...session,accumulatedScores:{Confidence:50},assessmentOverallScore:50});
 boundary.seed('qlue-dev-deletions',{userId:'unrelated'});
 db.onAnyCommand().callsFake((input,invoke)=>boundary.send({input,constructor:{name:invoke.constructor.name}}));
 // Use the actual command type: aws-sdk-client-mock exposes it via the stub.
 const ddb=require('../../src/lib/dynamodb');const spy=jest.spyOn(ddb.docClient,'send').mockImplementation(command=>boundary.send(command));
 try {await attempt.promote({sessionId:'s',userId:'owner',attemptId:'current'}, {analysisStatus:'UNAVAILABLE',dimensionScores:{},feedbackId:'f'});}
 finally {spy.mockRestore();}
 const stored=boundary.get('qlue-sessions',{sessionId:'s'});
 expect(stored.feedbackStatus).toBe('FAILED');expect(stored).not.toHaveProperty('accumulatedScores');expect(stored).not.toHaveProperty('assessmentOverallScore');
});
test('the unchanged app never receives a null score to render as zero',async()=>{
 db.on(GetCommand).callsFake(input=>({Item:input.Key.sessionId?{...session,feedbackStatus:'FAILED',feedbackId:'f'}:{feedbackId:'f',sessionId:'s',userId:'owner',attemptId:'current',analysisStatus:'UNAVAILABLE',overallScore:null}}));
 const r=await details({requestContext:{authorizer:{uid:'owner'}},pathParameters:{sessionId:'s'}});
 expect(r.statusCode).toBe(422);expect(JSON.parse(r.body).error).toBe('ASSESSMENT_UNAVAILABLE');
});
test('history, summary and trends use the canonical weighted grade',async()=>{
 const saved={...session,startedAt:Date.now(),accumulatedScores:{Relevance:75,'Specific Evidence':50,Structure:100,Clarity:75},assessmentOverallScore:73.8};
 db.on(QueryCommand).resolves({Items:[saved]});db.on(GetCommand).resolves({Item:{userId:'owner'}});
 const req={requestContext:{authorizer:{uid:'owner'}}};
 expect(JSON.parse((await history(req)).body).sessions[0].accumulatedScores).toEqual({Overall:74});
 expect(JSON.parse((await summary(req)).body).summary.averageScore).toBe(74);
 expect(JSON.parse((await trends(req)).body).trends[0].score).toBe(74);
});
