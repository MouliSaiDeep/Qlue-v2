jest.mock('../../src/models/session');
jest.mock('../../src/models/wsConnection');
jest.mock('../../src/lib/websocket');
jest.mock('../../src/lib/dynamodb');
jest.mock('../../src/lib/deletionJob',()=>({assertNotDeleting:jest.fn().mockResolvedValue()}));
const {handler} = require('../../src/handlers/websocket/sendTextHandler');
const {getSessionById} = require('../../src/models/session');
const {getConnection} = require('../../src/models/wsConnection');
const {postToConnection} = require('../../src/lib/websocket');
const fs = require('node:fs'), path = require('node:path');
const emitted = {};
beforeEach(()=>{
  jest.clearAllMocks();
  getConnection.mockResolvedValue({userId:'u',isActive:'true',emailVerified:true});
  postToConnection.mockResolvedValue(true);
});
test.each(['session_init','session_reconnect','turn_submit'])('%s classifies actual throttling and retains request identity', async operation=>{
  getSessionById.mockRejectedValue(Object.assign(new Error('SECRET candidate/provider text'),{name:'ProvisionedThroughputExceededException',$metadata:{httpStatusCode:400}}));
  await handler({requestContext:{connectionId:'c'},body:JSON.stringify({type:operation,payload:{sessionId:'s',turnId:'q0',requestId:'req-1',...(operation==='turn_submit'?{clientTurnId:'answer-1',textTranscript:'answer'}:{})}})});
  const sent = postToConnection.mock.calls.find(([,f])=>f.type==='turn_error')?.[1];
  expect(sent.payload).toMatchObject({code:429,category:'THROTTLED',retryable:true,terminal:false,sessionId:'s',turnId:'q0',requestId:'req-1',operation});
  expect(JSON.stringify(sent)).not.toContain('SECRET');
  if(operation==='turn_submit') expect(sent.payload.clientTurnId).toBe('answer-1');
  emitted[operation] = {...sent,payload:{...sent.payload,timestamp:0}};
});
test('connection authorization storage failure emits retryable error instead of rejecting Lambda',async()=>{
  getConnection.mockRejectedValue(Object.assign(new Error('SECRET connection read'),{name:'TimeoutError'}));
  await expect(handler({requestContext:{connectionId:'c'},body:JSON.stringify({type:'session_reconnect',payload:{sessionId:'s'}})})).resolves.toMatchObject({statusCode:503});
  expect(postToConnection).toHaveBeenCalledWith('c',expect.objectContaining({payload:expect.objectContaining({retryable:true,code:504})}));
});
test.each([
  ['primitive', 'SECRET dependency content', 503],
  ['plain object', {name:'ThrottlingException',message:'SECRET dependency content',$metadata:{httpStatusCode:400}}, 429],
])('non-Error %s dependency throw is safe and recoverable',async(_label,error,code)=>{
  const diagnostic = jest.spyOn(console,'error').mockImplementation(()=>{});
  try {
  getSessionById.mockRejectedValue(error);
  await handler({requestContext:{connectionId:'c'},body:JSON.stringify({type:'session_reconnect',payload:{sessionId:'s'}})});
  const sent=postToConnection.mock.calls.find(([,f])=>f.type==='turn_error')?.[1];
  expect(sent.payload).toMatchObject({code,retryable:true,terminal:false});
  expect(JSON.stringify(sent)).not.toContain('SECRET');
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('SECRET');
  } finally { diagnostic.mockRestore(); }
});
test.each([['malformed',null,400],['forbidden',{sessionId:'s',userId:'other'},403],['missing',null,404],['terminal',{sessionId:'s',userId:'u',currentState:'ERROR'},409]])('%s is terminal',async(label,session,code)=>{
  getSessionById.mockResolvedValue(session);
  await handler({requestContext:{connectionId:'c'},body:label==='malformed'?'{':JSON.stringify({type:'session_reconnect',payload:{sessionId:'s'}})});
  const sent=postToConnection.mock.calls.find(([,f])=>f.type==='turn_error')?.[1];
  expect(sent.payload).toMatchObject({code,retryable:false,terminal:true});
  emitted[label]={...sent,payload:{...sent.payload,timestamp:0}};
});
afterAll(()=>{
  const target=path.resolve(__dirname,'../../../frontend/test/fixtures/handler-errors.json');
  if(process.env.QLUE_WRITE_CONTRACT_FIXTURES==='1') fs.writeFileSync(target,JSON.stringify(emitted,null,2)+'\n');
  else if(fs.existsSync(target)) expect(emitted).toEqual(JSON.parse(fs.readFileSync(target)));
});
