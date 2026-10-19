const diagnostics=require('./logger').safeConsole;
// Standardizing on AWS SDK v3
/**
 * Application wrappers for AWS DynamoDB Document Client.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  BatchWriteCommand,
  BatchGetCommand
} = require('@aws-sdk/lib-dynamodb');

const rawClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  }
});

// Errors that are transient and safe to retry.
const RETRYABLE_ERRORS = new Set([
  'ProvisionedThroughputExceededException',
  'ThrottlingException',
  'RequestLimitExceeded',
  'InternalServerError',
  'TransactionConflictException',
  'TransactionInProgressException'
]);

/**
 * Generic retry wrapper with exponential backoff for transient DynamoDB errors.
 *
 * PERF-FIX #1: Previously every operation wrapped its own try/catch INSIDE the
 * retried function and returned { success: false } instead of throwing, so the
 * throughput exception never reached this wrapper and no retry ever happened.
 * Operations must now let errors propagate; callers convert to the
 * { success, data|error } contract AFTER retries are exhausted.
 */
async function withRetry(operation, maxRetries = 3, baseDelayMs = 200) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      // Cancelled transactions are safe to retry only when every failing item
      // reports a transient conflict/throttle. Business conditions remain final.
      const reasons = error.CancellationReasons;
      const transientCancellation = error.name === 'TransactionCanceledException' && Array.isArray(reasons) &&
        reasons.some(reason => ['TransactionConflict', 'ProvisionedThroughputExceeded', 'ThrottlingError'].includes(reason.Code)) &&
        reasons.every(reason => ['None', 'TransactionConflict', 'ProvisionedThroughputExceeded', 'ThrottlingError'].includes(reason.Code));
      if ((!RETRYABLE_ERRORS.has(error.name) && !transientCancellation) || attempt >= maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * baseDelayMs);
      diagnostics.debug(`DynamoDB transient error (${error.name}). Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Routes all sends through the exported docClient so tests can mock
 * module.exports.docClient.send directly.
 */
function send(command) {
  return require('./deadline').sendBounded(module.exports.docClient,command,{finish:true});
}

async function fencedSend(command, userId, parentChecks = []) {
  if (!userId) throw new Error('Writer identity is required');
  const input = command.input;
  const operations = input.TransactItems || [{ [command.constructor.name.replace('Command','')]: { ...input } }];
  for (const operation of operations) {
    for (const [name,value] of Object.entries(operation)) { operation[name] = {...value}; delete operation[name].ReturnValues; }
  }
  try {
    await send(new TransactWriteCommand({ TransactItems: [require('./deletionJob').deletionFence(userId), ...parentChecks, ...operations] }));
  } catch (error) {
    if (error.name === 'TransactionCanceledException' && error.CancellationReasons?.some(reason => reason.Code === 'ConditionalCheckFailed')) {
      error.name = 'ConditionalCheckFailedException';
    }
    throw error;
  }
  if (input.ReturnValues && input.Key) {
    const result = await send(new GetCommand({TableName:input.TableName,Key:input.Key,ConsistentRead:true}));
    return { Attributes: result.Item };
  }
  return {};
}

async function get(tableName, key, options={}) {
  // Log attribute NAMES only — values are user data / ids (finding 6).
  diagnostics.debug(`DDB GET | ${tableName} | Keys: ${Object.keys(key || {}).join(',')}`);
  try {
    const response = await withRetry(() => send(new GetCommand({ TableName: tableName, Key: key,...(options.consistentRead?{ConsistentRead:true}:{}) })));
    return { success: true, data: response.Item };
  } catch (error) {
    diagnostics.error(`DDB GET Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function put(tableName, item, options = {}) {
  // Log attribute NAMES only — the item holds user data (finding 6).
  diagnostics.debug(`DDB PUT | ${tableName} | Attrs: ${Object.keys(item || {}).join(',')}`);
  try {
    const params = { TableName: tableName, Item: item };
    // Optional conditional write (e.g. attribute_not_exists(pk)) so a caller can
    // make an at-least-once retry idempotent. A ConditionalCheckFailedException
    // is surfaced as { success:false, error } — NOT retried by withRetry — so
    // the caller can treat "already written" as an idempotent success.
    if (options.condition) params.ConditionExpression = options.condition;
    if (options.names) params.ExpressionAttributeNames = options.names;
    if (options.values) params.ExpressionAttributeValues = options.values;
    await withRetry(() => item.userId ? fencedSend(new PutCommand(params), item.userId, options.parentChecks || []) : send(new PutCommand(params)));
    return { success: true };
  } catch (error) {
    diagnostics.error(`DDB PUT Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function update(tableName, key, updateExpression, expressionAttributeValues, expressionAttributeNames = null, options = {}) {
  diagnostics.debug(`DDB UPDATE | ${tableName}`);
  try {
    const params = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
    if (expressionAttributeNames) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }
    // Optional ConditionExpression (e.g. only clear an fcmToken if it still
    // equals the stale one) — a ConditionalCheckFailedException is NOT
    // retryable, so it surfaces as { success:false, error } for the caller.
    if (options.condition) {
      params.ConditionExpression = options.condition;
    }
    if (key.userId && !options.allowDeletion) params.ConditionExpression = `attribute_exists(userId)${params.ConditionExpression ? ' AND (' + params.ConditionExpression + ')' : ''}`;
    const uid = options.userId || key.userId;
    const response = await withRetry(() => uid && !options.allowDeletion ? fencedSend(new UpdateCommand(params), uid, options.parentChecks || []) : send(new UpdateCommand(params)));
    return { success: true, data: response.Attributes };
  } catch (error) {
    diagnostics.error(`DDB UPDATE Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function remove(tableName, key) {
  diagnostics.debug(`DDB DELETE | ${tableName}`);
  try {
    await withRetry(() => send(new DeleteCommand({ TableName: tableName, Key: key })));
    return { success: true };
  } catch (error) {
    diagnostics.error(`DDB DELETE Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function query(tableName, keyCondition, options = {}) {
  diagnostics.debug(`DDB QUERY | ${tableName}`);
  try {
    const params = {
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: options.values,
      ...(options.names && { ExpressionAttributeNames: options.names }),
      ...(options.index && { IndexName: options.index }),
      ...(options.filter && { FilterExpression: options.filter }),
      ...(options.limit && { Limit: options.limit }),
      ...(options.projection && { ProjectionExpression: options.projection }),
      ...(options.exclusiveStartKey && { ExclusiveStartKey: options.exclusiveStartKey }),
      ...(options.scanIndexForward !== undefined && { ScanIndexForward: options.scanIndexForward })
    };
    const response = await withRetry(() => send(new QueryCommand(params)));
    return { success: true, data: response.Items, lastEvaluatedKey: response.LastEvaluatedKey };
  } catch (error) {
    diagnostics.error(`DDB QUERY Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function scan(tableName, filterExpression = null, values = null, names = null) {
  diagnostics.debug(`DDB SCAN | ${tableName}`);
  try {
    const params = { TableName: tableName };
    if (filterExpression) params.FilterExpression = filterExpression;
    if (values) params.ExpressionAttributeValues = values;
    if (names) params.ExpressionAttributeNames = names;
    const response = await withRetry(() => send(new ScanCommand(params)));
    return { success: true, data: response.Items };
  } catch (error) {
    diagnostics.error(`DDB SCAN Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function batchGet(tableName, keys) {
  diagnostics.debug(`DDB BATCH-GET | ${tableName}`);
  // Only handles up to 100 per AWS limits
  try {
    const params = {
      RequestItems: {
        [tableName]: { Keys: keys }
      }
    };
    const response = await withRetry(() => send(new BatchGetCommand(params)));
    return { success: true, data: response.Responses[tableName] };
  } catch (error) {
    diagnostics.error(`DDB BATCH-GET Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function batchWrite(tableName, putItems = [], deleteKeys = []) {
  diagnostics.debug(`DDB BATCH-WRITE | ${tableName}`);
  // Handles up to 25 items combined
  try {
    const requests = [];
    putItems.forEach(item => requests.push({ PutRequest: { Item: item } }));
    deleteKeys.forEach(key => requests.push({ DeleteRequest: { Key: key } }));

    const command = new BatchWriteCommand({
      RequestItems: { [tableName]: requests }
    });
    const response = await withRetry(() => send(command));
    return { success: true, unprocessedItems: response.UnprocessedItems };
  } catch (error) {
    diagnostics.error(`DDB BATCH-WRITE Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function transactWrite(items) {
  diagnostics.debug(`DDB TRANSACT-WRITE`);
  try {
    await withRetry(() => send(new TransactWriteCommand({ TransactItems: items })));
    return { success: true };
  } catch (error) {
    diagnostics.error(`DDB TRANSACT-WRITE Error`, error);
    return { success: false, error };
  }
}

module.exports = {
  docClient,
  fencedSend,
  withRetry,
  get,
  put,
  update,
  delete: remove, // export as delete
  query,
  scan,
  batchGet,
  batchWrite,
  transactWrite
};
