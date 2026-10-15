jest.mock('../../src/lib/feedbackDispatch', () => ({...jest.requireActual('../../src/lib/feedbackDispatch'), publishFeedbackJob:jest.fn()}));
jest.mock('../../src/lib/websocket', () => ({postToConnection:jest.fn(async()=>true)}));
jest.mock('../../src/lib/polly', () => ({synthesizeSpeech:jest.fn(async()=>({audioBase64:''}))}));
jest.mock('../../src/handlers/interview/generateQuestion', () => ({cleanAIResponse:t=>t,handler:jest.fn(async()=>({statusCode:200,body:JSON.stringify({question:'Please continue your introduction.'})}))}));
const {sessionMemory}=require('../helpers/sessionMemory');
const db=require('../../src/lib/dynamodb');
const sessionModel=require('../../src/models/session');
const input=require('../../src/handlers/interview/processUserInput');
const termination=require('../../src/handlers/interview/terminateSession');
const {publishFeedbackJob}=require('../../src/lib/feedbackDispatch');
const {generateAtomicTurn}=require('../../src/handlers/interview/asyncWorker');
const {getTranscriptBySession}=require('../../src/models/transcript');
let memory;
const row=()=>memory.table('qlue-sessions').get('s');
const terminate=async(reason='RECOGNITION_RECOVERY_LIMIT')=> {
  const r=await termination.handler({requestContext:{authorizer:{uid:'u'}},body:JSON.stringify({sessionId:'s',reason})});
  expect(r.statusCode).toBe(200);return JSON.parse(r.body);
};
const submit=async(text,id,isSilence=false)=> {
  const r=await input.handler({requestContext:{authorizer:{uid:'u'}},body:JSON.stringify({sessionId:'s',textTranscript:text,clientTurnId:id,isSilence})});
  expect(r.statusCode).toBe(200);return JSON.parse(r.body);
};
beforeEach(async()=> {
  jest.clearAllMocks();memory=sessionMemory();jest.spyOn(require('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient.prototype,'send').mockImplementation(memory.send);
  publishFeedbackJob.mockResolvedValue({published:true});
  await sessionModel.createSession('s','u','INTRO');
  await sessionModel.updateSessionState('s','LOADING_CONTEXT','INITIALIZING',{introStage:'AWAITING_FIRST_ATTEMPT'});
});
afterEach(()=>jest.restoreAllMocks());
test('new session has an explicit zero accepted-answer count',()=>expect(row().answeredCount).toBe(0));

test('audio expectation belongs only to a genuinely accepted answer and survives duplicate receipt replay once',async()=>{
 const send=async(text,id)=>input.handler({requestContext:{authorizer:{uid:'u'}},body:JSON.stringify({sessionId:'s',textTranscript:text,clientTurnId:id,audioExpected:true})});
 await send('Hello','fragment');expect(row().answerAudioExpectedIds).toBeUndefined();
 await send('My name is Rishi and I study engineering.','accepted');
 await send('My name is Rishi and I study engineering.','accepted');
 expect(row().answeredCount).toBe(1);expect(row().answerAudioExpectedIds).toEqual(['accepted']);
});
test('new untouched session terminates ungraded and releases its lock',async()=> {
  expect(await terminate('USER_INITIATED')).toMatchObject({feedbackExpected:false,reason:'USER_INITIATED'});
  expect(row()).toMatchObject({answeredCount:0,currentState:'TERMINATED'});
  expect(publishFeedbackJob).not.toHaveBeenCalled();
  expect(await getTranscriptBySession('s')).toEqual([]);
  expect(memory.table('qlue-sessions').has('LOCK#u')).toBe(false);
});
test('a stored failure reason survives a later manual End reason',async()=> {
  await sessionModel.updateSessionState('s','ERROR','LOADING_CONTEXT',{terminationReason:'CLARIFICATION_LIMIT'});
  expect(await terminate('USER_INITIATED')).toMatchObject({feedbackExpected:false,reason:'CLARIFICATION_LIMIT'});
  expect(row().terminationReason).toBe('CLARIFICATION_LIMIT');
});
test.each([
  ['fragment','Hello','RECOGNITION_RECOVERY_LIMIT'],
  ['clarification','Can you say that again?','CLARIFICATION_LIMIT']
])('%s-only real input -> termination never dispatches feedback',async(_,text,reason)=> {
  for(let n=1;n<=4;n++) {
    const r=await submit(text,`id-${n}`);expect(r.acceptedAnswer).toBeUndefined();expect(r.shouldTerminate).toBe(n===4);
    if(n===4) expect(r.reason).toBe(reason);
  }
  const result=await terminate(reason);
  expect(publishFeedbackJob).not.toHaveBeenCalled();
  expect(result.feedbackExpected).toBe(false);expect(result.reason).toBe(reason);
  expect(row()).toMatchObject({answeredCount:0,currentState:'TERMINATED',terminationReason:reason,discarded:true,feedbackExpected:false});
  expect(row().feedbackJob).toBeUndefined();expect(row().accumulatedScores).toEqual({});
  expect(memory.table('qlue-sessions').has('LOCK#u')).toBe(false);
  expect((await getTranscriptBySession('s')).filter(t=>t.speaker==='USER').map(t=>t.text)).toEqual([text,text,text,text]);
  expect(await terminate('USER_INITIATED')).toMatchObject({feedbackExpected:false,reason});
});
test('silence and explicit exit do not accept an answer or dispatch',async()=> {
  await submit('', 'silence', true);
  const exit=await submit('Please end the interview','exit');expect(exit.reason).toBe('USER_EXIT');
  expect((await terminate(exit.reason)).feedbackExpected).toBe(false);
  expect(row().answeredCount).toBe(0);expect(publishFeedbackJob).not.toHaveBeenCalled();
});
test('accepted answer then recognition failure retains genuine feedback, even with GSI lag',async()=> {
  await submit('I build reliable software and enjoy engineering','real');
  for(let n=1;n<=4;n++) await submit('Hello',`f-${n}`);
  memory.table('qlue-transcripts').clear(); // durable acceptance must win over GSI lag
  const result=await terminate();
  expect(result.feedbackExpected).toBe(true);expect(result.reason).toBe('RECOGNITION_RECOVERY_LIMIT');
  expect(row().answeredCount).toBe(1);expect(publishFeedbackJob).toHaveBeenCalledTimes(1);
});
test('duplicate and racing accepted inputs increment once',async()=> {
  const answer='I build reliable software and enjoy engineering';
  await Promise.all([submit(answer,'real'),submit(answer,'real')]);
  await submit(answer,'real');expect(row().answeredCount).toBe(1);
  expect((await getTranscriptBySession('s')).filter(t=>t.speaker==='USER')).toHaveLength(1);
});
test('an older accepted input replay cannot consume another answer count',async()=> {
  await submit('I build reliable software and enjoy engineering','first');
  await submit('I enjoy delivering useful applications and teamwork','second');
  await submit('I build reliable software and enjoy engineering','first');
  expect(row().answeredCount).toBe(2);
});
test('a real answer racing the empty decision cannot be discarded',async()=> {
  let raced=false;
  jest.spyOn(require('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient.prototype,'send').mockImplementation(async command=> {
    if(!raced && command.input.TransactItems?.some(op=>op.Update?.ExpressionAttributeValues?.[':feedbackExpected']===false)) {
      raced=true;await submit('I build reliable software and enjoy engineering','race-answer');
    }
    return memory.send(command);
  });
  expect((await terminate()).feedbackExpected).toBe(true);
  expect(row().answeredCount).toBe(1);expect(row().discarded).toBeUndefined();
  expect(publishFeedbackJob).toHaveBeenCalledTimes(1);
});
test('racing and repeated termination publish once and preserve the winning reason',async()=> {
  await submit('I build reliable software and enjoy engineering','real');
  await Promise.all([terminate(),terminate()]);await terminate('USER_INITIATED');
  expect(publishFeedbackJob).toHaveBeenCalledTimes(1);
  expect(row().terminationReason).toBe('RECOGNITION_RECOVERY_LIMIT');
});
test('duplicate termination while first publish is in flight does not publish twice',async()=> {
  await submit('I build reliable software and enjoy engineering','real');
  let release, started;const gate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  publishFeedbackJob.mockImplementationOnce(async()=>{started();await gate;return {published:true};});
  const first=terminate();await entered;const duplicate=terminate();
  await duplicate;release();await first;expect(publishFeedbackJob).toHaveBeenCalledTimes(1);
});
test('genuine legacy answer without count is retained',async()=> {
  delete row().answeredCount;
  await require('../../src/models/transcript').saveTranscript('s',1,'USER','I designed a reliable application',{eventId:'legacy'});
  expect((await terminate()).feedbackExpected).toBe(true);expect(publishFeedbackJob).toHaveBeenCalledTimes(1);
});
test('a genuine legacy answer older than the recent window is not discarded',async()=> {
  delete row().answeredCount;
  const save=require('../../src/models/transcript').saveTranscript;
  await save('s',1,'USER','Nithin',{eventId:'legacy-name'});
  for(let n=2;n<=25;n++) await save('s',n,'USER','Can you say that again?',{eventId:`control-${n}`});
  expect((await terminate()).feedbackExpected).toBe(true);expect(publishFeedbackJob).toHaveBeenCalledTimes(1);
});
test('legacy control/fragment text is not interpreted as an answer',async()=> {
  delete row().answeredCount;
  for(const [n,text] of ['Hello','Can you say that again?','Please end the interview'].entries()) await require('../../src/models/transcript').saveTranscript('s',n,'USER',text,{eventId:`legacy-${n}`});
  expect((await terminate()).feedbackExpected).toBe(false);expect(publishFeedbackJob).not.toHaveBeenCalled();
});
test('retained ungraded failure is readable in History/detail but absent from averages',async()=> {
  await submit('Hello','fragment');await terminate();
  const auth={requestContext:{authorizer:{uid:'u'}},pathParameters:{sessionId:'s'}};
  const history=await require('../../src/handlers/dashboard/getSessionHistory').handler(auth);
  expect(JSON.parse(history.body).sessions).toEqual([expect.objectContaining({feedbackExpected:false,discarded:true})]);
  const detail=await require('../../src/handlers/dashboard/getSessionDetail').handler(auth);
  expect(JSON.parse(detail.body)).toMatchObject({feedback:null,transcript:[expect.objectContaining({text:'Hello'})]});
  const forbidden=await require('../../src/handlers/dashboard/getTranscript').handler({...auth,requestContext:{authorizer:{uid:'other'}}});
  expect(forbidden.statusCode).toBe(403);
  // Guard against stale metrics ever making this ungraded row look scored.
  row().accumulatedScores={Clarity:99};
  const summary=JSON.parse((await require('../../src/handlers/dashboard/getDashboardSummary').handler(auth)).body);
  expect(summary.summary.averageScore).toBe(0);
  const stats=JSON.parse((await require('../../src/handlers/dashboard/getModuleStats').handler(auth)).body);
  expect(JSON.stringify(stats)).not.toContain('99');
  const trends=JSON.parse((await require('../../src/handlers/dashboard/getScoreTrends').handler(auth)).body);
  expect(trends.trends).toEqual([]);
});
test('ownership and deletion fences still block termination/transcript writes',async()=> {
  expect((await termination.handler({requestContext:{authorizer:{uid:'other'}},body:JSON.stringify({sessionId:'s'})})).statusCode).toBe(403);
  expect((await termination.handler({body:JSON.stringify({sessionId:'s'})})).statusCode).toBe(401);
  memory.table('qlue-deletion-jobs').set('u',{userId:'u'});
  expect((await termination.handler({requestContext:{authorizer:{uid:'u'}},body:JSON.stringify({sessionId:'s'})})).statusCode).toBe(409);
  expect(publishFeedbackJob).not.toHaveBeenCalled();expect(row().currentState).toBe('LOADING_CONTEXT');
  expect((await input.handler({requestContext:{authorizer:{uid:'u'}},body:JSON.stringify({sessionId:'s',textTranscript:'real answer',clientTurnId:'deleted'})})).statusCode).toBe(500);
  expect(await getTranscriptBySession('s')).toEqual([]);
});
test('two actual intro turns complete normally and dispatch once',async()=> {
  for(const [n,text] of ['I build reliable software and enjoy engineering','I enjoy teamwork and delivering useful applications'].entries()) {
    if(n) await sessionModel.updateSessionState('s','LOADING_CONTEXT',row().currentState);
    const r=await submit(text,`intro-${n}`);
    await generateAtomicTurn({sessionId:'s',connectionId:'offline',session:r.session,moduleType:'INTRO',currentAnswer:r.acceptedAnswer,currentAnswerTurnIndex:r.acceptedTurnIndex});
  }
  expect(row()).toMatchObject({answeredCount:2,introStage:'COMPLETE',terminationReason:'INTRO_COMPLETE',feedbackExpected:true});
  expect(publishFeedbackJob).toHaveBeenCalledTimes(1);
});
