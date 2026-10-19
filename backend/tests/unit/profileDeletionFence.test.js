const {mockClient}=require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,QueryCommand,TransactWriteCommand,UpdateCommand}=require('@aws-sdk/lib-dynamodb');
jest.mock('../../src/lib/deletionJob',()=>({getDeletion:jest.fn()}));
jest.mock('../../src/lib/dynamodb',()=>({fencedSend:jest.fn()}));
jest.mock('../../src/lib/bedrock',()=>({invokeModel:jest.fn()}));
const jobs=require('../../src/lib/deletionJob'),ddb=require('../../src/lib/dynamodb'),bedrock=require('../../src/lib/bedrock');
const {handler}=require('../../src/handlers/dashboard/updateGlobalProfile');
const db=mockClient(DynamoDBDocumentClient);
const event={Records:[{eventName:'INSERT',dynamodb:{NewImage:{userId:{S:'owner'}}}}]};
beforeEach(()=>{
  jest.resetAllMocks();db.reset();
  db.on(QueryCommand).resolves({Items:[{strengths:['clear'],weaknesses:['detail']}]});
  bedrock.invokeModel.mockResolvedValue({content:[{text:JSON.stringify({strengths:[],improvements:[],tip:'Practice'})}]});
});
test('late feedback events for a deleting or deleted account skip paid synthesis and all writes',async()=>{
  jobs.getDeletion.mockResolvedValue({status:'COMPLETE'});
  await handler(event);
  expect(bedrock.invokeModel).not.toHaveBeenCalled();expect(ddb.fencedSend).not.toHaveBeenCalled();
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});
test('normal profile updates atomically check the deletion fence and require an existing profile',async()=>{
  await handler(event);
  const [command,uid]=ddb.fencedSend.mock.calls[0];
  expect(command).toBeInstanceOf(UpdateCommand);expect(uid).toBe('owner');
  expect(command.input.ConditionExpression).toBe('attribute_exists(userId)');
  expect(db.commandCalls(UpdateCommand)).toHaveLength(0);
});
test('deletion racing model inference is a successful no-op rather than a poisonous stream retry',async()=>{
  ddb.fencedSend.mockRejectedValue(Object.assign(new Error('deleted during inference'),{name:'ConditionalCheckFailedException'}));
  expect((await handler(event)).statusCode).toBe(200);
});
test('transient profile write failure stays retryable',async()=>{
  ddb.fencedSend.mockRejectedValue(new Error('temporary failure'));
  await expect(handler(event)).rejects.toThrow('temporary failure');
});
