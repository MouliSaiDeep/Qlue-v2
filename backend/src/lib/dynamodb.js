const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

module.exports = dynamodb;
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

const rawClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  }
});

/**
 * Generic retry wrapper with exponential backoff for DynamoDB rate limits.
 */
async function withRetry(operation, maxRetries = 3, baseDelayMs = 200) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      if (error.name === 'ProvisionedThroughputExceededException') {
        attempt++;
        if (attempt >= maxRetries) {
          throw error;
        }
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.debug(`DynamoDB throughput exceeded. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

async function get(tableName, key) {
  console.debug(`DDB GET | ${tableName} | Key: ${JSON.stringify(key)}`);
  return withRetry(async () => {
    try {
      const command = new GetCommand({ TableName: tableName, Key: key });
      const response = await docClient.send(command);
      return { success: true, data: response.Item };
    } catch (error) {
      console.error(`DDB GET Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function put(tableName, item) {
  console.debug(`DDB PUT | ${tableName} | PKs: ${JSON.stringify(item)}`);
  return withRetry(async () => {
    try {
      const command = new PutCommand({ TableName: tableName, Item: item });
      await docClient.send(command);
      return { success: true };
    } catch (error) {
      console.error(`DDB PUT Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function update(tableName, key, updateExpression, expressionAttributeValues, expressionAttributeNames = null) {
  console.debug(`DDB UPDATE | ${tableName}`);
  return withRetry(async () => {
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
      const command = new UpdateCommand(params);
      const response = await docClient.send(command);
      return { success: true, data: response.Attributes };
    } catch (error) {
      console.error(`DDB UPDATE Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function remove(tableName, key) {
  console.debug(`DDB DELETE | ${tableName}`);
  return withRetry(async () => {
    try {
      const command = new DeleteCommand({ TableName: tableName, Key: key });
      await docClient.send(command);
      return { success: true };
    } catch (error) {
      console.error(`DDB DELETE Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function query(tableName, keyCondition, options = {}) {
  console.debug(`DDB QUERY | ${tableName}`);
  return withRetry(async () => {
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
      
      const commands = new QueryCommand(params);
      const response = await docClient.send(commands);
      return { success: true, data: response.Items, lastEvaluatedKey: response.LastEvaluatedKey };
    } catch (error) {
      console.error(`DDB QUERY Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function scan(tableName, filterExpression = null, values = null, names = null) {
  console.debug(`DDB SCAN | ${tableName}`);
  return withRetry(async () => {
    try {
      const params = { TableName: tableName };
      if (filterExpression) params.FilterExpression = filterExpression;
      if (values) params.ExpressionAttributeValues = values;
      if (names) params.ExpressionAttributeNames = names;

      const command = new ScanCommand(params);
      const response = await docClient.send(command);
      return { success: true, data: response.Items };
    } catch (error) {
      console.error(`DDB SCAN Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function batchGet(tableName, keys) {
  console.debug(`DDB BATCH-GET | ${tableName}`);
  // Only handles up to 100 per AWS limits
  return withRetry(async () => {
    try {
      const params = {
        RequestItems: {
          [tableName]: { Keys: keys }
        }
      };
      const command = new BatchGetCommand(params);
      const response = await docClient.send(command);
      return { success: true, data: response.Responses[tableName] };
    } catch (error) {
      console.error(`DDB BATCH-GET Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function batchWrite(tableName, putItems = [], deleteKeys = []) {
  console.debug(`DDB BATCH-WRITE | ${tableName}`);
  // Handles up to 25 items combined
  return withRetry(async () => {
    try {
      const requests = [];
      putItems.forEach(item => requests.push({ PutRequest: { Item: item } }));
      deleteKeys.forEach(key => requests.push({ DeleteRequest: { Key: key } }));

      const command = new BatchWriteCommand({
        RequestItems: { [tableName]: requests }
      });
      const response = await docClient.send(command);
      return { success: true, unprocessedItems: response.UnprocessedItems };
    } catch (error) {
      console.error(`DDB BATCH-WRITE Error | ${tableName}`, error);
      return { success: false, error };
    }
  });
}

async function transactWrite(items) {
  console.debug(`DDB TRANSACT-WRITE`);
  return withRetry(async () => {
    try {
      const command = new TransactWriteCommand({ TransactItems: items });
      await docClient.send(command);
      return { success: true };
    } catch (error) {
      console.error(`DDB TRANSACT-WRITE Error`, error);
      return { success: false, error };
    }
  });
}

module.exports = {
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
