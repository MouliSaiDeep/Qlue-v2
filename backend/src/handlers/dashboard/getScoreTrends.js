const diagnostics=require('../../lib/logger').safeConsole;
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { queryAllItems } = require('../../lib/paginate');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

// BE-BUG #18 FIX: was `SESSIONS_TABLE_NAME` — an env var that is never set, so
// this always fell back to the literal 'qlue-sessions' and broke the moment the
// real table name differed from the default.
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

// Numeric epoch-ms cutoff for GSI_UserIdStartedAt (sort key `startedAt`, type N).
function getCutoffTimestamp(periodStr) {
    const now = new Date();
    if (periodStr === '7d') now.setDate(now.getDate() - 7);
    else if (periodStr === '30d') now.setDate(now.getDate() - 30);
    else if (periodStr === '90d') now.setDate(now.getDate() - 90);
    else return null;
    return now.getTime();
}

function calculateAggregateScore(scoresObj, assessmentOverallScore) {
    if (Number.isFinite(assessmentOverallScore)) return Math.round(assessmentOverallScore);
    if (!scoresObj || Object.keys(scoresObj).length === 0) return 0;
    let total = 0, count = 0;
    for (const v of Object.values(scoresObj)) { total += parseInt(v, 10); count++; }
    return Math.round(total / count);
}

exports.handler = async (event) => {
    try {
        // SECURITY: the custom authorizer returns { uid } in the context, not
        // Cognito-style claims, so `claims.sub` was always undefined and the
        // effective identity came from the ?userId= query string — any signed-in
        // user could read anyone else's score history. Trust the authorizer only.
        const auth = event.requestContext?.authorizer;
        const userId = auth?.uid || auth?.claims?.sub || auth?.principalId;
        const period = event.queryStringParameters?.period || '30d';

        if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };

        const cutoff = getCutoffTimestamp(period);

        // BE-BUG #18 FIX: was IndexName 'UserDateIndex' with a `startTime >=`
        // (ISO string) condition — that index does NOT exist in the stack, so
        // every trends query threw. Use the real GSI_UserIdStartedAt and its
        // numeric `startedAt` sort key.
        let keyCond = 'userId = :uid';
        const expVals = { ':uid': userId };

        if (cutoff) {
            keyCond += ' AND startedAt >= :cutoff';
            expVals[':cutoff'] = cutoff;
        }

        const sessionParams = {
            TableName: SESSIONS_TABLE,
            IndexName: 'GSI_UserIdStartedAt',
            KeyConditionExpression: keyCond,
            ExpressionAttributeValues: expVals
        };

        // Drain all pages so long-range trends aren't truncated at 1MB.
        const sessions = await queryAllItems(docClient, sessionParams);

        // Formatting for UI Trend Line
        const trends = sessions
            .filter(s => !s.discarded && s.feedbackExpected !== false && s.accumulatedScores && Object.keys(s.accumulatedScores).length > 0)
            .map(s => ({
                sessionId: s.sessionId,
                // `startTime` is the ISO display timestamp; fall back to the
                // numeric startedAt if an older item lacks it.
                date: s.startTime || (s.startedAt ? new Date(s.startedAt).toISOString() : null),
                moduleType: s.moduleType,
                score: calculateAggregateScore(s.accumulatedScores, s.assessmentOverallScore)
            }));

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ userId, period, trends })
        };
    } catch (err) {
        diagnostics.error('getScoreTrends failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Could not load score trends. Please try again.' }) };
    }
};
