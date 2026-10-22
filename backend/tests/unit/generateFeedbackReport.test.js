const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const {DynamoDBDocumentClient,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {mockClient}=require('aws-sdk-client-mock');
jest.mock('../../src/lib/bedrock');
const {invokeModel}=require('../../src/lib/bedrock');
const a=require('../../src/lib/feedbackAssessment');
const {handler}=require('../../src/handlers/feedback/generateFeedbackReport');
const db=mockClient(DynamoDBDocumentClient),lambda=mockClient(LambdaClient);
beforeEach(()=>{
 db.reset();lambda.reset();jest.clearAllMocks();
 db.on(GetCommand).callsFake(input=>({Item:input.Key.sessionId?{sessionId:input.Key.sessionId,userId:'owner'}:undefined}));
 lambda.on(InvokeCommand).resolves({});process.env.STORE_FEEDBACK_LAMBDA='store';
});
const payload=()=>JSON.parse(Buffer.from(lambda.commandCalls(InvokeCommand)[0].args[0].input.Payload).toString());
function result(){
 const p=a.prepare({moduleType:'INTRO',answerPairs:[{answerId:'a',question:'Introduce yourself.',answer:'I built an API for interview practice.'}]});
 return a.report(p,a.validate(JSON.stringify({answers:[{answerId:'a',levels:[3,2,4,3],evidenceIds:Array(4).fill('e1')}]}),p));
}
test('formats validated results without a second model call and preserves weighted grade',async()=>{
 await handler({sessionId:'s',userId:'owner',moduleType:'INTRO',assessmentResult:result()});
 expect(payload().overallScore).toBe(73.8);expect(payload().assessment.version).toBe(a.VERSION);
 expect(payload().dimensionScores).not.toHaveProperty('Confidence');expect(invokeModel).not.toHaveBeenCalled();
});
test('old or missing results are explicitly unavailable, never 0 or 50',async()=>{
 await handler({sessionId:'s',userId:'owner',moduleType:'INTRO',dimensionScores:{Confidence:50}});
 expect(payload()).toMatchObject({analysisStatus:'UNAVAILABLE',overallScore:null,status:'FAILED',dimensionScores:{}});
 expect(invokeModel).not.toHaveBeenCalled();
});
test('downstream failure is retried by the existing async delivery boundary',async()=>{
 lambda.on(InvokeCommand).rejects(new Error('Storage error'));
 await expect(handler({sessionId:'s',userId:'owner',moduleType:'INTRO',assessmentResult:result()})).rejects.toThrow('Storage error');
});
test('invalid result envelope cannot be stored as a completed assessment',async()=>{
 const value=result();value.dimensionScores.Clarity='100';
 await expect(handler({sessionId:'s',userId:'owner',moduleType:'INTRO',assessmentResult:value})).rejects.toThrow(a.InvalidAssessment);
 expect(lambda.calls()).toHaveLength(0);
});
