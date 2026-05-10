const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions'; // BE-BUG #11 FIX: was SESSIONS_TABLE_NAME

/**
 * AWS Lambda Handler: GET /dashboard/history
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing user context' })
            };
        }

        const { lastSessionId, lastStartedAt, moduleType, limit = 10 } = event.queryStringParameters || {};

        const params = {
            TableName: SESSIONS_TABLE,
            IndexName: 'GSI_UserIdStartedAt',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': userId
            },
            ScanIndexForward: false, // Newest first
            Limit: parseInt(limit)
        };

        if (moduleType) {
            params.FilterExpression = 'moduleType = :mt';
            params.ExpressionAttributeValues[':mt'] = moduleType;
        }

        if (lastSessionId && lastStartedAt) {
            params.ExclusiveStartKey = {
                userId: userId,
                sessionId: lastSessionId,
                startedAt: lastStartedAt // Use string directly, not parsed as int
            };
        }

        const command = new QueryCommand(params);
        const result = await docClient.send(command);

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessions: result.Items || [],
                lastEvaluatedKey: result.LastEvaluatedKey || null
            })
        };

    } catch (error) {
        console.error('Get Session History Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
