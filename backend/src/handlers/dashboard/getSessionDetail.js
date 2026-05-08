const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE_NAME || 'qlue-sessions';
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'qlue-feedback';
const TRANSCRIPTS_TABLE = process.env.TRANSCRIPTS_TABLE || 'qlue-transcripts';

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
        const sessionCmd = new GetCommand({
            TableName: SESSIONS_TABLE,
            Key: { sessionId }
        });
        const sessionRes = await docClient.send(sessionCmd);
        const session = sessionRes.Item;

        if (!session || session.userId !== userId) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'NOT_FOUND', message: 'Session not found' })
            };
        }

        // 2. Get Associated Feedback (if any)
        const feedbackCmd = new QueryCommand({
            TableName: FEEDBACK_TABLE,
            IndexName: 'GSI_SessionId',
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: {
                ':sid': sessionId
            },
            Limit: 1
        });
        const feedbackRes = await docClient.send(feedbackCmd);
        const feedback = feedbackRes.Items?.[0] || null;

        // 3. Get Transcript
        const transcriptCmd = new QueryCommand({
            TableName: TRANSCRIPTS_TABLE,
            IndexName: 'GSI_SessionIdTurnIndex',
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: {
                ':sid': sessionId
            },
            ScanIndexForward: true // Ascending by turnIndex
        });
        const transcriptRes = await docClient.send(transcriptCmd);
        const transcript = transcriptRes.Items || [];

        return {
            statusCode: 200,
            body: JSON.stringify({
                session,
                feedback,
                transcript
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
