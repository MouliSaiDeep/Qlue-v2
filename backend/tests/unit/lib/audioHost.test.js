const {mockClient}=require('aws-sdk-client-mock');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const calls=mockClient(LambdaClient),db=mockClient(DynamoDBDocumentClient);
const {wake}=require('../../../src/lib/audioHost');
const originalEnv={...process.env},originalFetch=global.fetch;
beforeEach(()=>{
 calls.reset();db.reset();
 Object.assign(process.env,{AUDIO_HOST_WAKE_FUNCTION:'wake-existing-host',STT_SESSIONS_TABLE:'stt',SESSIONS_TABLE:'sessions',DELETION_JOBS_TABLE:'deletions',STT_GATEWAY_URL:'wss://audio.example.invalid/audio'});
 db.on(GetCommand).callsFake(input=>({Item:input.Key.pk==='CONTROL'?{rolloutEnabled:true,hostInstanceId:'i-0123456789abcdef0'}:undefined}));
 db.on(TransactWriteCommand).resolves({});calls.on(InvokeCommand).resolves({StatusCode:202,Payload:Buffer.from('{"ready":true}')});
 global.fetch=jest.fn(async()=>new Response(JSON.stringify({ready:true,sttEnabled:true,hosting:'ondemand'})));
});
afterEach(()=>{process.env={...originalEnv};global.fetch=originalFetch;});

test('a healthy owned host needs no nested Lambda execution and retains atomic session/deletion guards',async()=>{
 expect(await wake('owner','session')).toEqual({ready:true});expect(calls.commandCalls(InvokeCommand)).toHaveLength(0);
 const items=db.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
 expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ConditionCheck:expect.objectContaining({TableName:'sessions'})}),expect.objectContaining({ConditionCheck:expect.objectContaining({TableName:'deletions'})})]));
 expect(items.find(i=>i.Update).Update).toMatchObject({Key:{pk:'HOST#i-0123456789abcdef0'},ConditionExpression:'attribute_not_exists(stopToken)'});
 expect(global.fetch.mock.calls[0][1].redirect).toBe('error');
});
test('an unavailable host queues one asynchronous wake and returns the existing retryable response',async()=>{
 global.fetch.mockResolvedValue(new Response('',{status:503}));
 expect(await wake('owner','session')).toMatchObject({ready:false,code:'STT_GATEWAY_WARMING'});
 expect(calls.commandCalls(InvokeCommand)).toHaveLength(1);expect(calls.commandCalls(InvokeCommand)[0].args[0].input.InvocationType).toBe('Event');
});
test('a shutdown claim is not overwritten or reported as ready',async()=>{
 db.on(TransactWriteCommand).rejects({name:'TransactionCanceledException',CancellationReasons:[{Code:'None'},{Code:'None'},{Code:'ConditionalCheckFailed'}]});
 expect(await wake('owner','session')).toMatchObject({ready:false,code:'STT_GATEWAY_WARMING'});expect(global.fetch).not.toHaveBeenCalled();
 expect(calls.commandCalls(InvokeCommand)[0].args[0].input.InvocationType).toBe('Event');
});
test('a deletion fence aborts without health checks or wake calls',async()=>{
 db.on(GetCommand).callsFake(input=>({Item:input.Key.pk==='CONTROL'?{rolloutEnabled:true,hostInstanceId:'i-0123456789abcdef0'}:input.TableName==='deletions'?{status:'COMPLETE'}:undefined}));
 db.on(TransactWriteCommand).rejects({name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'}]});
 await expect(wake('owner','session')).rejects.toMatchObject({code:'ACCOUNT_DELETING'});expect(global.fetch).not.toHaveBeenCalled();expect(calls.commandCalls(InvokeCommand)).toHaveLength(0);
});
test('oversized or malformed health data never admits a stream',async()=>{
 global.fetch.mockResolvedValue(new Response(' '.repeat(5000)));
 expect(await wake('owner','session')).toMatchObject({ready:false,code:'STT_GATEWAY_WARMING'});
});
test('legacy host configuration and background initialization preserve their existing contracts',async()=>{
 db.on(GetCommand).resolves({});expect(await wake('owner','session')).toEqual({ready:true});
 expect(calls.commandCalls(InvokeCommand)[0].args[0].input.InvocationType).toBe('RequestResponse');
 expect(await wake('owner','session',{background:true})).toEqual({queued:true});
});
