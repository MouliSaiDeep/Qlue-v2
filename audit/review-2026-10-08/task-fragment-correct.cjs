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
  const submit=async(text,id)=>{
    session.currentState=realSession.INTERVIEW_STATES.LOADING_CONTEXT;
    const result=await input.handler({requestContext:{authorizer:{uid:'offline-user'}},body:JSON.stringify({sessionId:'offline-session',textTranscript:text,isSilence:false,clientTurnId:id})});
    assert.equal(result.statusCode,200);return JSON.parse(result.body);
  };
  const first=await submit('Hello.','fragment-1');assert.equal(first.isReprompt,true);
  const duplicate=await submit('Hello.','fragment-1');assert.equal(duplicate.session.fragmentRetries,1);
  for(let i=2;i<=4;i++) {
    const body=await submit('Hello.',`fragment-${i}`);
    assert.equal(body.shouldTerminate,i===4);
    assert.equal(body.session.introStage,realSession.INTRO_STAGES.AWAITING_FIRST_ATTEMPT);
    assert.equal(body.acceptedAnswer,undefined);
    if(i===2) {
      const older=await submit('Hello.','fragment-1');
      assert.equal(older.session.fragmentRetries,2);
    }
    if(i<4)await generateAtomicTurn({connectionId:'offline-connection',sessionId:'offline-session',session:body.session,moduleType:'INTRO',preGeneratedText:body.nextAIResponse,isReprompt:true});
    else {assert.equal(body.reason,'RECOGNITION_RECOVERY_LIMIT');assert.match(body.nextAIResponse,/recognition/i);}
  }
  session.fragmentRetries=2;
  for(const [i,text] of ['I develop microphone projects and repeat experiments at work','I ask questions at work and build reliable software'].entries()) {
    const body=await submit(text,`real-${i}`);assert.equal(body.session.fragmentRetries,0);
    assert.equal(body.acceptedAnswer,text);
    await generateAtomicTurn({connectionId:'offline-connection',sessionId:'offline-session',session:body.session,moduleType:'INTRO',currentAnswer:body.acceptedAnswer,currentAnswerTurnIndex:body.acceptedTurnIndex});
  }
  assert.equal(terminations.at(-1).reason,'INTRO_COMPLETE');
  console.log(JSON.stringify({correct:true,externalCalls:0,limit:3,duplicateSafe:true,resetsOnAnswer:true,normalCompletion:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
