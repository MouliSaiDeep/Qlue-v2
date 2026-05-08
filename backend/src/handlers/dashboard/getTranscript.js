const { getTranscriptBySession } = require('../../models/transcript');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const SESSIONS_TABLE = process.env.SESSIONS_TABLE_NAME || 'qlue-sessions';

/**
 * AWS Lambda Handler: GET /dashboard/transcript/{sessionId}
 */
exports.handler = async (event) => {
    try {
        // Resolve userId from authorizer
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

        // SECURITY FIX: Verify user owns the session before returning transcript
        const sessionCmd = new GetCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId }
        });
        const sessionRes = await docClient.send(sessionCmd);
        const session = sessionRes.Item;

        if (!session || session.userId !== userId) {
            return {
                statusCode: 403,
                body: JSON.stringify({ error: 'FORBIDDEN', message: 'You do not have access to this transcript' })
            };
        }

        // Fetch transcript from DB
        const transcript = await getTranscriptBySession(sessionId);

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                transcript
            })
        };

    } catch (error) {
        console.error('Get Transcript Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
