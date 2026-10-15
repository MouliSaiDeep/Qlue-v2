const { GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const TABLE = process.env.DELETION_JOBS_TABLE || 'qlue-deletion-jobs';
const client = () => require('./dynamodb').docClient;

async function requestDeletion(userId) {
  const now = Date.now();
  const result = await require('./deadline').sendBounded(client(),new UpdateCommand({ TableName: TABLE, Key: { userId },
    UpdateExpression: 'SET #s = if_not_exists(#s, :pending), requestedAt = if_not_exists(requestedAt, :now), drainUntil = if_not_exists(drainUntil, :drain), checkpoints = if_not_exists(checkpoints, :empty)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pending':'PENDING', ':now':now, ':drain':now + 20 * 60 * 1000, ':empty': {} }, ReturnValues:'ALL_NEW' }));
  return result.Attributes;
}
async function getDeletion(userId) {
  const result = await require('./deadline').sendBounded(client(),new GetCommand({ TableName:TABLE, Key:{userId}, ConsistentRead:true }));
  return result.Item;
}
async function assertNotDeleting(userId) {
  if (!userId) throw new Error('Account identity required');
  if (await getDeletion(userId)) { const e = new Error('Account deletion is in progress or complete'); e.code='ACCOUNT_DELETING'; e.statusCode=409; throw e; }
}
function deletionFence(userId) {
  return { ConditionCheck: { TableName:TABLE, Key:{userId}, ConditionExpression:'attribute_not_exists(userId)' } };
}
async function checkpoint(userId, step, value) {
  await require('./deadline').sendBounded(client(),new UpdateCommand({TableName:TABLE,Key:{userId},
    UpdateExpression:'SET checkpoints.#step = :value',ExpressionAttributeNames:{'#step':step},ExpressionAttributeValues:{':value':value},ConditionExpression:'attribute_exists(userId)'}));
}
async function setStatus(userId,status,extra={}) {
  await require('./deadline').sendBounded(client(),new UpdateCommand({TableName:TABLE,Key:{userId},UpdateExpression:'SET #s = :s, updatedAt = :now, detail = :detail',
    ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':status,':now':Date.now(),':detail':extra},ConditionExpression:'attribute_exists(userId)'}));
}
async function pendingJobs() {
  const jobs=[]; let key;
  do {const res=await require('./deadline').sendBounded(client(),new ScanCommand({TableName:TABLE,ExclusiveStartKey:key,FilterExpression:'#s <> :complete',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':complete':'COMPLETE'}})); jobs.push(...(res.Items||[]));key=res.LastEvaluatedKey;}while(key);
  return jobs;
}
module.exports={TABLE,requestDeletion,getDeletion,assertNotDeleting,deletionFence,checkpoint,setStatus,pendingJobs};
