// Bounded, durable rotation through retained history. Only an operations cursor
// is stored; existing job owners, attempts and account fences still own work.
const {randomUUID}=require('node:crypto');
const {GetCommand,UpdateCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const ddb=require('./dynamodb'),deadline=require('./deadline');
async function sweep({table,keyName='sessionId',name,filter,values,names,visit,maxPages=10}) {
 const key={[keyName]:`RECOVERY#${name}`},owner=randomUUID();
 try {
  await deadline.sendBounded(ddb.docClient,new UpdateCommand({TableName:table,Key:key,
   UpdateExpression:'SET recoveryCursor = :yes, leaseOwner = :owner, leaseExpires = :expiry',
   ConditionExpression:'attribute_not_exists(leaseOwner) OR leaseExpires < :now',
   ExpressionAttributeValues:{':yes':true,':owner':owner,':expiry':Date.now()+75000,':now':Date.now()}}));
 }catch(error){if(error.name==='ConditionalCheckFailedException')return {busy:true};throw error;}
 let start,pages=0;
 try {
  const stored=await deadline.sendBounded(ddb.docClient,new GetCommand({TableName:table,Key:key,ConsistentRead:true}));
  start=stored.Item?.resumeKey;
  while(pages<maxPages&&deadline.remaining()>5000) {
   const page=await deadline.sendBounded(ddb.docClient,new ScanCommand({TableName:table,ExclusiveStartKey:start,Limit:25,
    FilterExpression:filter,ExpressionAttributeValues:values,...(names?{ExpressionAttributeNames:names}:{})}));
   // Persist only fully visited pages. An interrupted page repeats safely.
   for(const row of page.Items||[]) {
    if(deadline.remaining()<5000)return {pages,deferred:true};
    if(!row.recoveryCursor)await visit(row);
   }
   start=page.LastEvaluatedKey;pages++;
   await deadline.sendBounded(ddb.docClient,new UpdateCommand({TableName:table,Key:key,
    UpdateExpression:start?'SET resumeKey = :key':'REMOVE resumeKey',ConditionExpression:'leaseOwner = :owner',
    ExpressionAttributeValues:{':owner':owner,...(start?{':key':start}:{})}}));
   if(!start)break;
  }
  return {pages,deferred:!!start};
 }finally {
  await deadline.finalize(()=>deadline.sendBounded(ddb.docClient,new UpdateCommand({TableName:table,Key:key,
   UpdateExpression:'REMOVE leaseOwner, leaseExpires',ConditionExpression:'leaseOwner = :owner',ExpressionAttributeValues:{':owner':owner}}),{finish:true}));
 }
}
module.exports={sweep};
