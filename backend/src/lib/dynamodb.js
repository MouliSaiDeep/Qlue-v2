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
  'InternalServerError'
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
      if (!RETRYABLE_ERRORS.has(error.name) || attempt >= maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.debug(`DynamoDB transient error (${error.name}). Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Routes all sends through the exported docClient so tests can mock
 * module.exports.docClient.send directly.
 */
function send(command) {
  return module.exports.docClient.send(command);
}

async function get(tableName, key) {
  console.debug(`DDB GET | ${tableName} | Key: ${JSON.stringify(key)}`);
  try {
    const response = await withRetry(() => send(new GetCommand({ TableName: tableName, Key: key })));
    return { success: true, data: response.Item };
  } catch (error) {
    console.error(`DDB GET Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function put(tableName, item) {
  console.debug(`DDB PUT | ${tableName} | PKs: ${JSON.stringify(item)}`);
  try {
    await withRetry(() => send(new PutCommand({ TableName: tableName, Item: item })));
    return { success: true };
  } catch (error) {
    console.error(`DDB PUT Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function update(tableName, key, updateExpression, expressionAttributeValues, expressionAttributeNames = null) {
  console.debug(`DDB UPDATE | ${tableName}`);
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
    const response = await withRetry(() => send(new UpdateCommand(params)));
    return { success: true, data: response.Attributes };
  } catch (error) {
    console.error(`DDB UPDATE Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function remove(tableName, key) {
  console.debug(`DDB DELETE | ${tableName}`);
  try {
    await withRetry(() => send(new DeleteCommand({ TableName: tableName, Key: key })));
    return { success: true };
  } catch (error) {
    console.error(`DDB DELETE Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function query(tableName, keyCondition, options = {}) {
  console.debug(`DDB QUERY | ${tableName}`);
  try {
    const params = {
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: options.values,
      ...(options.names && { ExpressionAttributeNames: options.names }),
      ...(options.index && { IndexName: options.index }),
      ...(options.filter && { FilterExpression: options.filter }),
      ...(options.limit && { Limit: options.limit }),
      ...(options.scanIndexForward !== undefined && { ScanIndexForward: options.scanIndexForward })
    };
    const response = await withRetry(() => send(new QueryCommand(params)));
    return { success: true, data: response.Items, lastEvaluatedKey: response.LastEvaluatedKey };
  } catch (error) {
    console.error(`DDB QUERY Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function scan(tableName, filterExpression = null, values = null, names = null) {
  console.debug(`DDB SCAN | ${tableName}`);
  try {
    const params = { TableName: tableName };
    if (filterExpression) params.FilterExpression = filterExpression;
    if (values) params.ExpressionAttributeValues = values;
    if (names) params.ExpressionAttributeNames = names;
    const response = await withRetry(() => send(new ScanCommand(params)));
    return { success: true, data: response.Items };
  } catch (error) {
    console.error(`DDB SCAN Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function batchGet(tableName, keys) {
  console.debug(`DDB BATCH-GET | ${tableName}`);
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
    console.error(`DDB BATCH-GET Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function batchWrite(tableName, putItems = [], deleteKeys = []) {
  console.debug(`DDB BATCH-WRITE | ${tableName}`);
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
    console.error(`DDB BATCH-WRITE Error | ${tableName}`, error);
    return { success: false, error };
  }
}

async function transactWrite(items) {
  console.debug(`DDB TRANSACT-WRITE`);
  try {
    await withRetry(() => send(new TransactWriteCommand({ TransactItems: items })));
    return { success: true };
  } catch (error) {
    console.error(`DDB TRANSACT-WRITE Error`, error);
    return { success: false, error };
  }
}

module.exports = {
  docClient,
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
