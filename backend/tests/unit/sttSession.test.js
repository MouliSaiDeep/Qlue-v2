const {mockClient}=require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const db=mockClient(DynamoDBDocumentClient);
jest.mock('../../src/models/session',()=>({getSessionById:jest.fn()}));
jest.mock('../../src/lib/deletionJob',()=>({assertNotDeleting:jest.fn(),deletionFence:uid=>({ConditionCheck:{TableName:'deletions',Key:{userId:uid},ConditionExpression:'attribute_not_exists(userId)'}})}));
jest.mock('../../src/lib/firebase',()=>({getAuth:jest.fn()}));
jest.mock('../../src/lib/audioHost',()=>({wake:jest.fn()}));
const {issue,evidence,hash}=require('../../src/lib/sttSession');
const session={sessionId:'session',userId:'owner',currentState:'USER_RESPONDING',lastTurnPayload:{turnId:'question'},moduleType:'RESUME'};
const body={sessionId:'session',turnId:'question',captureId:'capture',epoch:1,language:'en-IN',stability:'off'};
beforeEach(()=>{
  jest.clearAllMocks();db.reset();db.on(TransactWriteCommand).resolves({});
  process.env.STT_SESSIONS_TABLE='stt';process.env.AWS_STT_ENABLED='true';process.env.STT_GATEWAY_URL='wss://audio.example.com/audio';process.env.SESSIONS_TABLE='sessions';
  require('../../src/models/session').getSessionById.mockResolvedValue(session);
});
afterAll(()=>{delete process.env.STT_SESSIONS_TABLE;delete process.env.AWS_STT_ENABLED;delete process.env.STT_GATEWAY_URL;});
const exp=()=>Math.floor(Date.now()/1000)+3600;
test('server rollout off fails before any cloud admission',async()=>{
  process.env.AWS_STT_ENABLED='false';await expect(issue('owner',body,exp())).rejects.toMatchObject({code:'AWS_STT_DISABLED'});
  expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
});
test('malformed capture bodies fail before cloud admission',async()=>{
  for(const body of [null,[],"invalid"])await expect(issue('owner',body,exp())).rejects.toMatchObject({code:'INVALID_CAPTURE',statusCode:400});
  expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
});
test('ticket is opaque, hashed at rest, expires promptly and is bound to current question',async()=>{
  const result=await issue('owner',body,exp());expect(result.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const tx=db.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
  const row=tx.find(x=>x.Put)?.Put.Item;expect(row.pk).toBe('TICKET#'+hash(result.ticket));
  expect(JSON.stringify(row)).not.toContain(result.ticket);expect(row).toMatchObject({userId:'owner',turnId:'question',language:'en-IN',stability:'off',offsetSamples:0});
  expect(row.expiresAt).toBeLessThanOrEqual(Date.now()/1000+30);
  expect(tx.some(x=>x.ConditionCheck?.Key?.pk==='CONTROL')).toBe(true);
  expect(tx.some(x=>x.Update?.ExpressionAttributeValues?.[':max']===12)).toBe(true);
});
test.each([
  ['other',body,'FORBIDDEN'],['owner',{...body,turnId:'wrong'},'STALE_QUESTION'],
  ['owner',{...body,language:'xx-XX'},'INVALID_STT_CONFIG'],['owner',{...body,epoch:-1},'INVALID_CAPTURE']
])('wrong user/question/config is rejected (%s)',async(uid,request,code)=>{
  await expect(issue(uid,request,exp())).rejects.toMatchObject({code});expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
});
test('expired identity cannot mint a paid stream',async()=>{await expect(issue('owner',body,0)).rejects.toMatchObject({code:'IDENTITY_EXPIRED'});});
test('a cold host returns a retryable response before issuing a short-lived ticket',async()=>{
  process.env.AUDIO_HOST_WAKE_FUNCTION='wake';
  try{
    require('../../src/lib/audioHost').wake.mockResolvedValue({ready:false,code:'STT_GATEWAY_WARMING'});
    await expect(issue('owner',body,exp())).rejects.toMatchObject({code:'STT_GATEWAY_WARMING',statusCode:503});
    expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
    require('../../src/lib/audioHost').wake.mockResolvedValue({ready:true});
    expect((await issue('owner',body,exp())).ticket).toBeDefined();
  }finally{delete process.env.AUDIO_HOST_WAKE_FUNCTION;}
});
test('other accounts cannot wake audio compute',async()=>{
  process.env.AUDIO_HOST_WAKE_FUNCTION='wake';
  try{await expect(issue('other',body,exp())).rejects.toMatchObject({code:'FORBIDDEN'});expect(require('../../src/lib/audioHost').wake).not.toHaveBeenCalled();}
  finally{delete process.env.AUDIO_HOST_WAKE_FUNCTION;}
});
test('shared admission denial does not return a ticket',async()=>{
  db.on(TransactWriteCommand).rejects(Object.assign(new Error('denied'),{name:'TransactionCanceledException'}));
  await expect(issue('owner',body,exp())).rejects.toMatchObject({code:'STT_ADMISSION_DENIED'});
});
test('reconnect derives its absolute offset from prior server evidence and rejects other accounts',async()=>{
  const id='a'.repeat(32);db.on(GetCommand).resolves({Item:{userId:'owner',sessionId:'session',turnId:'question',captureId:'capture',epoch:1,streamId:id,status:'INTERRUPTED',nextOffsetSamples:3200,expiresAt:exp()}});
  expect((await issue('owner',{...body,epoch:2,previousStreamId:id},exp())).offsetSamples).toBe(3200);
  db.on(GetCommand).resolves({Item:{userId:'other'}});
  await expect(issue('owner',{...body,epoch:2,previousStreamId:id},exp())).rejects.toMatchObject({code:'INVALID_RESUME'});
});
const stream=(extra={})=>({userId:'owner',sessionId:'session',turnId:'question',captureId:'capture',streamId:'a'.repeat(32),status:'FINISHED',expiresAt:exp(),
  originalTranscript:'I use Flutter',confidence:{mean:0,missing:1},language:'en-IN',vocabulary:{applied:false},offsetSamples:0,nextOffsetSamples:16000,...extra});
const submission=(extra={})=>({turnId:'question',textTranscript:'I use Flutter',stt:{provider:'aws-transcribe',streamIds:['a'.repeat(32)]},...extra});

test('lost completion is recovered from authoritative evidence without minting another paid stream',async()=>{
  const prior=stream({epoch:1,segments:[{resultId:'final',partial:false,text:'I use Flutter'}]});
  db.on(GetCommand).resolves({Item:prior});
  const result=await issue('owner',{...body,epoch:2,previousStreamId:prior.streamId},exp());
  expect(result).toMatchObject({priorCompleted:true,streamId:prior.streamId,originalTranscript:'I use Flutter',segments:prior.segments});
  expect(result.ticket).toBeUndefined();expect(db.commandCalls(TransactWriteCommand)).toHaveLength(0);
});
test('client confidence is discarded; raw server zero and missing values remain authoritative',async()=>{
  db.on(GetCommand).resolves({Item:stream()});const input=submission({asr:{mean:1}});
  const result=await evidence('owner',session,input);expect(input.asr).toBeUndefined();expect(result.recognition[0].confidence).toEqual({mean:0,missing:1});
  expect(result.confidenceAppliesTo).toBe('original-recognition-only');
});

test('authoritative uncertainty offsets survive beyond the temporary stream TTL',async()=>{
 const text='I use Flutter. People';
 db.on(GetCommand).resolves({Item:stream({originalTranscript:text,segments:[{partial:false,text,words:[
 {text:'I',confidence:.99},{text:'use',confidence:.99},{text:'Flutter',confidence:.99},{text:'People',confidence:.01}]}]})});
 const result=await evidence('owner',session,submission({textTranscript:text}));
 expect(result.uncertainty).toEqual({version:1,spans:[{start:15,end:21}],incomplete:false});
});
test.each([{userId:'other'},{turnId:'old'},{status:'STREAMING'},{status:'FINISHED',unfinished:[{text:'pending'}]},{expiresAt:1}])('untrusted, stale and incomplete evidence cannot be graded (%j)',async extra=>{
  db.on(GetCommand).resolves({Item:stream(extra)});await expect(evidence('owner',session,submission())).rejects.toMatchObject({code:'ASR_NOT_FINAL'});
});
test('edited text requires explicit confirmation and retains recognition separately',async()=>{
  db.on(GetCommand).resolves({Item:stream()});const input=submission({textTranscript:'I use Flutter and Dart'});
  await expect(evidence('owner',session,input)).rejects.toMatchObject({code:'ASR_EDIT_CONFIRMATION_REQUIRED'});
  input.stt.edited=true;const result=await evidence('owner',session,input);
  expect(result.originalTranscript).toBe('I use Flutter');expect(result.correctedTranscript).toBe(input.textTranscript);
});
test('existing Android/typed submissions remain compatible and cannot attach forged ASR',async()=>{
  const input={textTranscript:'answer',asr:{mean:1}};expect(await evidence('owner',session,input)).toBeNull();expect(input.asr).toBeUndefined();
});
test('ticket route checks the current verified Firebase identity even behind the authorizer',async()=>{
  const verify=jest.fn().mockResolvedValue({uid:'other',email_verified:true,exp:exp()});require('../../src/lib/firebase').getAuth.mockResolvedValue({verifyIdToken:verify});
  const handler=require('../../src/handlers/interview/sttTicket').handler;
  expect((await handler({requestContext:{authorizer:{uid:'owner'}},headers:{Authorization:'Bearer signed'},body:JSON.stringify(body)})).statusCode).toBe(403);
  verify.mockResolvedValue({uid:'owner',email_verified:true,exp:exp()});
  expect((await handler({requestContext:{authorizer:{uid:'owner'}},headers:{Authorization:'Bearer signed'},body:JSON.stringify(body)})).statusCode).toBe(200);
  expect(verify).toHaveBeenCalledWith('signed',true);
});
