const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CORE_TABLE = process.env.CORE_TABLE;

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

        const { lastSessionSk, lastStartedAt, moduleType, limit = 10 } = event.queryStringParameters || {};

        const params = {
            TableName: CORE_TABLE,
            IndexName: 'UserSessionTimeIndex',
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

        if (lastSessionSk && lastStartedAt) {
            params.ExclusiveStartKey = {
                PK: `USER#${userId}`,
                SK: lastSessionSk,
                userId: userId,
                startedAt: lastStartedAt
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
