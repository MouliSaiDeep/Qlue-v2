const {DocumentBoundary}=require('../helpers/documentBoundary');
const ddb=require('../../src/lib/dynamodb');
const {refreshQuestionAudio}=require('../../src/lib/questionAudio');
let db;
const session=()=>({sessionId:'s',userId:'u',currentState:'USER_RESPONDING',lastTurnPayload:{turnId:'q',expectsAnswer:true,audioKey:'audio/s/q.mp3'}});
beforeEach(()=>{
 db=new DocumentBoundary();jest.spyOn(ddb.docClient,'send').mockImplementation(c=>db.send(c));
 process.env.AUDIO_BUCKET='question-audio-test';process.env.AWS_ACCESS_KEY_ID='LOCAL_TEST_KEY';process.env.AWS_SECRET_ACCESS_KEY='LOCAL_TEST_SECRET';
});
afterEach(()=>{jest.restoreAllMocks();delete process.env.AUDIO_BUCKET;delete process.env.AWS_ACCESS_KEY_ID;delete process.env.AWS_SECRET_ACCESS_KEY;});
test('real SDK refresh signs only the stored current object, without a model call or state mutation',async()=>{
 const url=new URL(await refreshQuestionAudio(session(),'q'));
 expect(decodeURIComponent(url.pathname)).toBe('/audio/s/q.mp3');
 expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
 expect(db.calls.every(c=>c.constructor.name==='GetCommand')).toBe(true);
});
test.each([
 ['previous turn',s=>s,'previous'],
 ['foreign session key',s=>({...s,lastTurnPayload:{...s.lastTurnPayload,audioKey:'audio/other/q.mp3'}}),'q'],
 ['processing',s=>({...s,currentState:'PROCESSING_RESPONSE'}),'q'],
 ['closing',s=>({...s,lastTurnPayload:{...s.lastTurnPayload,expectsAnswer:false}}),'q'],
 ['legacy URL without stored key',s=>({...s,lastTurnPayload:{turnId:'q',audioUrl:'https://old'}}),'q'],
])('%s cannot mint a question URL',async(_label,change,id)=>{
 expect(await refreshQuestionAudio(change(session()),id)).toBeNull();expect(db.calls).toHaveLength(0);
});
test('deletion fence rejects refresh before signing',async()=>{
 db.seed('qlue-deletion-jobs',{userId:'u'});
 await expect(refreshQuestionAudio(session(),'q')).rejects.toMatchObject({code:'ACCOUNT_DELETING'});
});
