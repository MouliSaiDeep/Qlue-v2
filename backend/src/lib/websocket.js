/**
 * WebSocket API Gateway helpers and connection managers.
 */
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const ddb = require('./dynamodb');

const WS_CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE;

// Cache the clients by endpoint to avoid reallocation per request since lambda may handle requests from multiple stages
const apigwClients = new Map();

function getApiClient(endpoint) {
  if (!apigwClients.has(endpoint)) {
    // Strip wss:// and replace with https:// for API GW Mgmt Client
    const httpsEndpoint = endpoint.replace('wss://', 'https://');
    apigwClients.set(endpoint, new ApiGatewayManagementApiClient({
      endpoint: httpsEndpoint,
      region: process.env.AWS_REGION || 'us-east-1',
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        requestTimeout: 15000
      })
    }));
  }
  return apigwClients.get(endpoint);
}

/**
 * Registers a new WebSocket connection to DDB with a 2-hour TTL.
 */
async function registerConnection(connectionId, userId) {
  const ttlTime = Math.floor(Date.now() / 1000) + (2 * 60 * 60); // 2 hours
  
  const item = {
    connectionId,
    userId,
    isActive: 'true',
    connectedAt: Date.now(),
    ttl: ttlTime
  };
  
  return await ddb.put(WS_CONNECTIONS_TABLE, item);
}

/**
 * Marks connection as dead inside DDB.
 */
async function deregisterConnection(connectionId) {
  return await ddb.update(
    WS_CONNECTIONS_TABLE,
    { connectionId },
    'SET isActive = :val',
    { ':val': 'false' }
  );
}

/**
 * Finds user's active connection via GSI.
 */
async function getActiveConnection(userId) {
  const response = await ddb.query(
    WS_CONNECTIONS_TABLE,
    'userId = :uid AND isActive = :active',
    {
      values: {
        ':uid': userId,
        ':active': 'true'
      },
      index: 'GSI_UserIdIsActive'
    }
  );

  if (response.success && response.data && response.data.length > 0) {
    // Return the latest connection if there are multiple somehow
    const sorted = response.data.sort((a, b) => b.connectedAt - a.connectedAt);
    return sorted[0].connectionId;
  }
  return null;
}

/**
 * Posts direct message string or JSON to a connection ID.
 */
async function postToConnection(connectionId, data) {
  const endpoint = process.env.WEBSOCKET_ENDPOINT;
  if (!endpoint) {
    console.error('WEBSOCKET_ENDPOINT is not set');
    return false;
  }

  const client = getApiClient(endpoint);
  const payload = typeof data === 'string' ? data : JSON.stringify(data);

  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(payload)
    });
    
    await client.send(command);
    return true;
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 410 || error.name === 'GoneException') {
      console.warn(`Connection ${connectionId} is stale. Deregistering.`);
      await deregisterConnection(connectionId);
    } else {
      console.error(`Post to connection ${connectionId} failed`, error);
    }
    return false;
  }
}

/**
 * Posts to a user's active connection.
 */
async function broadcastToUser(userId, data) {
  const connectionId = await getActiveConnection(userId);
  if (!connectionId) {
    console.debug(`No active websocket connection found for user ${userId}`);
    return false;
  }

  return await postToConnection(connectionId, data);
}

module.exports = {
  registerConnection,
  deregisterConnection,
  getActiveConnection,
  postToConnection,
  broadcastToUser
};
