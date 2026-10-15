const {mockClient}=require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,GetCommand,UpdateCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {sweep}=require('../../src/lib/recoveryScan');
const io=mockClient(DynamoDBDocumentClient);
beforeEach(()=>io.reset());
test('retained history rotates durably across bounded sweeps rather than restarting at the first page',async()=>{
 let cursor,scanned=0;const starts=[],visited=[];
 io.on(GetCommand).callsFake(()=>({Item:{resumeKey:cursor}}));
 io.on(UpdateCommand).callsFake(input=>{if(input.UpdateExpression==='SET resumeKey = :key')cursor=input.ExpressionAttributeValues[':key'];if(input.UpdateExpression==='REMOVE resumeKey')cursor=undefined;return {};});
 io.on(ScanCommand).callsFake(input=>{
  starts.push(input.ExclusiveStartKey?.sessionId??0);scanned+=input.Limit;
  const offset=input.ExclusiveStartKey?.sessionId||0,last=offset+input.Limit;
  return {Items:last===1000?[{sessionId:'pending-at-tail'}]:[],...(last<1000?{LastEvaluatedKey:{sessionId:last}}:{})};
 });
 for(let run=0;run<4;run++)await sweep({table:'qlue-sessions',name:'test',filter:'feedbackStatus = :pending',values:{':pending':'PENDING'},visit:async row=>visited.push(row.sessionId)});
 expect(scanned).toBe(1000);expect(starts[10]).toBe(250);expect(starts[20]).toBe(500);expect(visited).toEqual(['pending-at-tail']);expect(cursor).toBeUndefined();
});
test('racing cursor owners skip before any scan',async()=>{
 io.on(UpdateCommand).rejects(Object.assign(new Error('busy'),{name:'ConditionalCheckFailedException'}));
 expect(await sweep({table:'t',name:'test'})).toEqual({busy:true});expect(io.commandCalls(ScanCommand)).toHaveLength(0);
});
test('failed job visit retains page boundary for retry and releases cursor lease',async()=>{
 io.on(GetCommand).resolves({Item:{resumeKey:{sessionId:25}}});io.on(UpdateCommand).resolves({});io.on(ScanCommand).resolves({Items:[{sessionId:'pending'}],LastEvaluatedKey:{sessionId:50}});
 await expect(sweep({table:'t',name:'test',visit:async()=>{throw Error('transport');}})).rejects.toThrow('transport');
 expect(io.commandCalls(UpdateCommand).some(c=>c.args[0].input.UpdateExpression==='SET resumeKey = :key')).toBe(false);
 expect(io.commandCalls(UpdateCommand).at(-1).args[0].input.UpdateExpression).toBe('REMOVE leaseOwner, leaseExpires');
});
