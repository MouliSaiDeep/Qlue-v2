const diagnostics=require('../../lib/logger').safeConsole;
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { getTranscriptBySession } = require('../../models/transcript');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions'; // BE-BUG #11 FIX: was SESSIONS_TABLE_NAME
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'qlue-feedback';

async function getCurrentFeedback(session) {
    // The session owns the current attempt. Retained historical reports must
    // not turn a pending retry back into a failure or replace its final result.
    if (session.feedbackExpected === false || session.feedbackStatus === 'PENDING') return null;
    const belongs = report => report && report.sessionId === session.sessionId
        && (report.userId === undefined || report.userId === session.userId)
        && (!session.feedbackAttemptId || report.attemptId === session.feedbackAttemptId);
    const feedbackId = session.feedbackId || (session.feedbackAttemptId
        ? `${session.sessionId}#${session.feedbackAttemptId}` : null);
    if (feedbackId) {
        const result = await require('../../lib/deadline').sendBounded(docClient, new GetCommand({
            TableName: FEEDBACK_TABLE, Key: {feedbackId}, ConsistentRead: true
        }));
        return belongs(result.Item) ? result.Item : null;
    }

    // Genuine legacy sessions may lack both pointers. Read every query page,
    // then select the latest owned report; the GSI has no chronological sort key.
    const reports = [];
    let key;
    do {
        const result = await require('../../lib/deadline').sendBounded(docClient, new QueryCommand({
            TableName: FEEDBACK_TABLE, IndexName: 'GSI_SessionId',
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: {':sid':session.sessionId},
            ...(key ? {ExclusiveStartKey:key} : {})
        }));
        reports.push(...(result.Items || []).filter(belongs));
        key = result.LastEvaluatedKey;
    } while (key);
    const timestamp = report => Number(report.generatedAt) || Date.parse(report.generatedAt) || 0;
    reports.sort((a,b) => timestamp(b)-timestamp(a)
        || String(b.feedbackId).localeCompare(String(a.feedbackId)));
    return reports[0] || null;
}

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
            Key: { sessionId },
            ConsistentRead: true
        });
        const sessionRes = await require('../../lib/deadline').sendBounded(docClient,sessionCmd);
        const session = sessionRes.Item;

        if (!session || session.userId !== userId) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'NOT_FOUND', message: 'Session not found' })
            };
        }

        // 2. Get Associated Feedback (if any)
        const feedback = await getCurrentFeedback(session);

        // 3. Get Transcript
        // I-08: delegate to the model, which paginates the GSI (a single page
        // caps at 1MB, truncating long interviews) and orders with the shared
        // comparator. The previous inline sort tie-broke by subtracting ISO
        // strings — `(a.timestamp||0) - (b.timestamp||0)` is NaN for strings, so
        // same-turnIndex USER/AI pairs could appear in either order in the report.
        const transcript = await getTranscriptBySession(sessionId);

        return {
            statusCode: 200,
            body: JSON.stringify({
                session,
                feedback,
                transcript
            })
        };

    } catch (error) {
        diagnostics.error('Get Session Detail Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' })
        };
    }
};
