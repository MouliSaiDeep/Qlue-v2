// Offline characterization using real input/turn logic and in-memory I/O.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../backend/src');
delete process.env.AUDIO_BUCKET;
const resolve = file => require.resolve(path.join(root, file));
const stub = (file, exports) => {
  const id = resolve(file);
  require.cache[id] = {id, filename:id, loaded:true, exports};
};
const realSession = require(path.join(root, 'models/session'));
const realTranscript = require(path.join(root, 'models/transcript'));
let session = {sessionId:'offline-session',userId:'offline-user',moduleType:'INTRO',turnCount:1,
  currentState:realSession.INTERVIEW_STATES.LOADING_CONTEXT,
  introStage:realSession.INTRO_STAGES.AWAITING_FIRST_ATTEMPT};
const frames = [], saved = [], terminations = [], prompts = [];
stub('models/session', {...realSession,
  getSession:async()=>session, getSessionById:async()=>session,
  updateSessionState:async(id,state,expected,updates={})=>{
    session={...session,...updates,currentState:state,
      turnCount:session.turnCount+(updates.incrementTurnCount?1:0)};
    return session;
  }
});
stub('models/transcript', {...realTranscript,
  saveTranscript:async(...args)=>{saved.push(args);return {};},
  getContextWindow:async()=>[]
});
stub('models/user', {getUserById:async()=>({name:'Candidate'})});
stub('models/resume', {getResumeById:async()=>null});
stub('lib/websocket', {postToConnection:async(_,message)=>{frames.push(message);return true;}});
stub('lib/polly', {synthesizeSpeech:async()=>({audioBase64:''})});
stub('handlers/interview/terminateSession', {handler:async(event)=>{
  terminations.push(JSON.parse(event.body));return {statusCode:200};
}});
stub('handlers/interview/generateQuestion', {
  cleanAIResponse:text=>text,
  handler:async(event)=>{
    prompts.push(event.body.introStage);
    return {statusCode:200,body:JSON.stringify({question:'Please repeat your answer; I will keep the current question.'})};
  }
});
const input = require(path.join(root,'handlers/interview/processUserInput'));
const {generateAtomicTurn} = require(path.join(root,'handlers/interview/asyncWorker'));
(async()=>{
  const observations=[];
  for(const text of ['Could you please repeat the question?', 'My microphone is not taking my response correctly']) {
    session.currentState=realSession.INTERVIEW_STATES.LOADING_CONTEXT;
    const result=await input.handler({requestContext:{authorizer:{uid:'offline-user'}},
      body:JSON.stringify({sessionId:'offline-session',textTranscript:text,isSilence:false,clientTurnId:`answer-${observations.length}`})});
    assert.equal(result.statusCode,200);
    const body=JSON.parse(result.body);
    assert.equal(body.acceptedAnswer,undefined);
    assert.equal(Boolean(body.isReprompt),true);
    await generateAtomicTurn({connectionId:'offline-connection',sessionId:'offline-session',
      session:body.session,moduleType:'INTRO',isReprompt:!!body.isReprompt,
      currentAnswer:body.acceptedAnswer,currentAnswerTurnIndex:body.acceptedTurnIndex});
    const turn=frames.filter(f=>f.type==='turn_complete').at(-1).payload;
    observations.push({text,stage:session.introStage,expectsAnswer:turn.expectsAnswer,question:turn.questionText});
  }
  assert.deepEqual(prompts,[undefined,undefined]);
  assert.equal(terminations.length,0);
  assert.equal(saved.length,2);
  assert.equal(observations[1].expectsAnswer,true);
  const submit = async (text,id) => {
    session.currentState=realSession.INTERVIEW_STATES.LOADING_CONTEXT;
    const result=await input.handler({requestContext:{authorizer:{uid:'offline-user'}},body:JSON.stringify({sessionId:'offline-session',textTranscript:text,clientTurnId:id,isSilence:false})});
    return JSON.parse(result.body);
  };
  for (const [i,text] of ['I build microphones and repeat questions in my testing work','I build reliable software'].entries()) {
    const body=await submit(text,`real-${i}`);
    assert.equal(body.acceptedAnswer,text);assert.equal(Boolean(body.isReprompt),false);
    if(i===0) {
      const duplicate=await submit(text,`real-${i}`);
      assert.equal(duplicate.session.incrementAnsweredCount,false);
    }
    await generateAtomicTurn({connectionId:'offline-connection',sessionId:'offline-session',session:body.session,moduleType:'INTRO',currentAnswer:body.acceptedAnswer,currentAnswerTurnIndex:body.acceptedTurnIndex});
  }
  assert.equal(terminations.at(-1).reason,'INTRO_COMPLETE');
  assert.equal(session.introStage,realSession.INTRO_STAGES.COMPLETE);
  assert.deepEqual(prompts.slice(-2),['COACHING','CLOSING']);
  session={...session,currentState:realSession.INTERVIEW_STATES.LOADING_CONTEXT,introStage:realSession.INTRO_STAGES.AWAITING_FIRST_ATTEMPT,clarificationRetries:0,clarificationId:null};
  const first=await submit('Could you please repeat the question?','clarify-first');
  const duplicate=await submit('Could you please repeat the question?','clarify-first');
  assert.equal(first.session.clarificationRetries,1);assert.equal(duplicate.session.clarificationRetries,1);
  for(let i=2;i<=4;i++) {
    const body=await submit('Could you please repeat the question?',`clarify-${i}`);
    assert.equal(body.shouldTerminate,i===4);
    assert.equal(body.session.introStage,realSession.INTRO_STAGES.AWAITING_FIRST_ATTEMPT);
    if(i===4)assert.equal(body.reason,'CLARIFICATION_LIMIT');
  }
  const exit=await submit('Please end the interview','exit');assert.equal(exit.reason,'USER_EXIT');
  const report={confirmed:true,externalCalls:0,observations,terminationReason:null};
  fs.writeFileSync(path.join(__dirname,'task-intro-correct-result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
