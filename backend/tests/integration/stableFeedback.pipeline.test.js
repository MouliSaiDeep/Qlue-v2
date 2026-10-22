// Exercise restored grading through the real transport/store boundaries.
// Only external model and AWS I/O are replaced.
const {mockClient}=require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
jest.mock('../../src/lib/bedrock',()=>({
 ...jest.requireActual('../../src/lib/bedrock'),invokeModel:jest.fn()
}));
process.env.GENERATE_REPORT_LAMBDA='stable-report';
process.env.STORE_FEEDBACK_LAMBDA='stable-store';
const analyze=require('../../src/handlers/feedback/analyzeTranscript').handler;
const report=require('../../src/handlers/feedback/generateFeedbackReport').handler;
const store=require('../../src/handlers/feedback/storeFeedbackReport').handler;
const {invokeModel}=require('../../src/lib/bedrock');
const db=mockClient(DynamoDBDocumentClient),lambda=mockClient(LambdaClient);
const session={sessionId:'synthetic-stable',userId:'synthetic-owner',moduleType:'INTRO',feedbackAttemptId:'attempt-1',answeredCount:2};
beforeEach(()=>{
 db.reset();lambda.reset();invokeModel.mockReset();
 db.on(GetCommand).callsFake(input=>({Item:input.Key.sessionId?session:undefined}));
 db.on(TransactWriteCommand).resolves({});
});
test('two accepted introductions grade the final revision with one model call and retain attempt ownership',async()=>{
 const transcript='AI: Introduce yourself.\nUSER: I am Rishi, a final year BTech student. I built an API and want a backend role.\nAI: Please revise your introduction.\nUSER: I am Rishi. My tested API project developed my backend skills, and I want to apply them as an engineer.';
 const answerPairs=[{answerId:'first',question:'Introduce yourself.',answer:'I am Rishi, a final year BTech student. I built an API and want a backend role.'},
 {answerId:'final',question:'Please revise your introduction.',answer:'I am Rishi. My tested API project developed my backend skills, and I want to apply them as an engineer.'}];
 invokeModel.mockResolvedValueOnce({content:[{text:JSON.stringify({coaching:require('../helpers/coachingFixture')('final'),answers:[
 {answerId:'first',levels:[2,2,2,2],evidenceIds:Array(4).fill('e1')},
 {answerId:'final',levels:[3,3,4,3],evidenceIds:Array(4).fill('e1')}]})}]});
 let stored;
 lambda.on(InvokeCommand).callsFake(async input=>{
  const payload=JSON.parse(Buffer.from(input.Payload).toString());
  expect(payload.attemptId).toBe('attempt-1');
  if(input.FunctionName==='stable-report')await report(payload);
  else {expect(input.FunctionName).toBe('stable-store');stored=payload;await store(payload);}
  return {};
 });
 await analyze({...session,attemptId:'attempt-1',transcript,answerPairs});
 expect(stored.dimensionScores).toEqual({Relevance:75,'Specific Evidence':75,Structure:100,Clarity:75});
 expect(stored.overallScore).toBe(81.3);
 expect(stored.strengths).toHaveLength(3);expect(stored.weaknesses).toHaveLength(0);
 expect(stored.executiveSummary).toContain('final revised introduction');
 expect(stored.assessment.practiceProgress).toEqual({baseline:50,final:81.3,change:31.3});
 expect(invokeModel).toHaveBeenCalledTimes(1);
 expect(stored.status).toBe('COMPLETE');expect(stored.analysisStatus).toBe('OK');
 expect(stored).not.toHaveProperty('coaching');expect(stored).not.toHaveProperty('deliveryMeasurements');
 const writes=db.commandCalls(TransactWriteCommand).map(c=>c.args[0].input.TransactItems);
 const put=writes.flat().find(x=>x.Put?.Item?.feedbackId)?.Put;
 expect(put.Item.feedbackId).toBe('synthetic-stable#attempt-1');
 expect(put.Item.dimensionScores).toEqual(stored.dimensionScores);
 expect(writes.flat().some(x=>x.Update?.ExpressionAttributeValues?.[':status']==='COMPLETE')).toBe(true);
 expect(lambda.commandCalls(InvokeCommand)).toHaveLength(2);
});
test('stale feedback attempt never invokes the model or writes a report',async()=>{
 expect(await analyze({...session,attemptId:'old-attempt',transcript:'Earlier answer'})).toEqual({success:true,stale:true});
 expect(invokeModel).not.toHaveBeenCalled();expect(lambda.calls()).toHaveLength(0);expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
});
