const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const CORE_TABLE = process.env.CORE_TABLE;

/**
 * AWS Lambda Handler: GET /dashboard/session/{sessionId}
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

        const sessionId = event.pathParameters?.sessionId;
        if (!sessionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'sessionId is required' })
            };
        }

        // 1. Get Session
        const sessionCmd = new QueryCommand({
            TableName: CORE_TABLE,
            IndexName: 'SessionIdIndex',
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: { ':sid': sessionId },
            Limit: 1
        });
        const sessionRes = await docClient.send(sessionCmd);
        const session = sessionRes.Items?.[0];

        if (!session || session.userId !== userId) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'NOT_FOUND', message: 'Session not found' })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                session,
                feedback: session.feedback || null
            })
        };

    } catch (error) {
        console.error('Get Session Detail Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
