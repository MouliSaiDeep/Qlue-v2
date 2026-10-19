const {mockClient}=require('aws-sdk-client-mock');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const {SQSClient,SendMessageCommand}=require('@aws-sdk/client-sqs');
const lambda=mockClient(LambdaClient),sqs=mockClient(SQSClient);
const {handler}=require('../../src/handlers/recovery/dispatchRecovery');
const record=(task,id='1')=>({eventSource:'aws:sqs',messageId:id,body:JSON.stringify({version:1,dueAt:Date.now()-1,...task})});
beforeEach(()=>{
  lambda.reset();sqs.reset();lambda.on(InvokeCommand).resolves({StatusCode:202});sqs.on(SendMessageCommand).resolves({});
  process.env.RECOVERY_QUEUE_URL='shared';
  for(const name of ['ANALYSIS','DELETION','DISPATCH','FEEDBACK','RESUME','TURN'])process.env[name+'_TARGET']=name.toLowerCase();
});
afterAll(()=>{lambda.restore();sqs.restore();});
test.each(['analysis','deletion','dispatch','feedback','resume','turn'])('routes %s only to its configured target',async worker=>{
  expect(await handler({Records:[record({worker,jobId:'j'})]})).toEqual({batchItemFailures:[]});
  expect(lambda.commandCalls(InvokeCommand)[0].args[0].input).toMatchObject({FunctionName:worker,InvocationType:'Event'});
});
test('long delays requeue with the original absolute deadline and worker identity',async()=>{
  const dueAt=Date.now()+3600000;
  await handler({Records:[record({worker:'deletion',dueAt,userId:'u'})]});
  expect(lambda.calls()).toHaveLength(0);
  const queued=sqs.commandCalls(SendMessageCommand)[0].args[0].input;
  expect(queued.DelaySeconds).toBe(900);expect(JSON.parse(queued.MessageBody)).toMatchObject({worker:'deletion',dueAt,userId:'u'});
});
test('invalid routes and rejected forwards retain only their own records',async()=>{
  lambda.on(InvokeCommand,{FunctionName:'resume'}).resolves({StatusCode:500});
  expect(await handler({Records:[record({worker:'__proto__'},'bad'),record({worker:'resume'},'retry'),record({worker:'turn'},'ok')]}))
    .toEqual({batchItemFailures:[{itemIdentifier:'bad'},{itemIdentifier:'retry'}]});
});
