const diagnostics=require('../../lib/logger').safeConsole;
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { queryAllItems } = require('../../lib/paginate');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

function getCutoffTimestamp(periodStr) {
    const now = new Date();
    if (periodStr === '7d') now.setDate(now.getDate() - 7);
    else if (periodStr === '30d') now.setDate(now.getDate() - 30);
    else if (periodStr === '90d') now.setDate(now.getDate() - 90);
    else return null; 
    return now.getTime(); // Return numeric timestamp for GSI_UserIdStartedAt
}

exports.handler = async (event) => {
    try {
        // SECURITY: see getScoreTrends — the ?userId= fallback took precedence
        // over the real authorizer context and exposed other users' stats.
        const auth = event.requestContext?.authorizer;
        const userId = auth?.uid || auth?.claims?.sub || auth?.principalId;
        const period = event.queryStringParameters?.period || '30d';

        if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };

        const cutoff = getCutoffTimestamp(period);
        
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

        // BE-BUG #18 FIX: drain every page so the radar reflects all sessions
        // in the period, not just the first 1MB of them.
        const sessions = await queryAllItems(docClient, sessionParams);

        // Radar Chart Data aggregation
        // BUG FIX: JD had no bucket, so job-match sessions were dropped by the
        // `!dimensionsBreakdown[mod]` guard below — excluded from their own
        // radar AND from the OVERALL aggregate.
        const dimensionsBreakdown = {
            OVERALL: {},
            RESUME: {},
            WEBSITE: {},
            HR: {},
            INTRO: {},
            JD: {}
        };
        const counts = { OVERALL: {}, RESUME: {}, WEBSITE: {}, HR: {}, INTRO: {}, JD: {} };

        for (const session of sessions) {
            if (session.discarded || session.feedbackExpected === false) continue;
            const mod = session.moduleType;
            if (!mod || !dimensionsBreakdown[mod] || !session.accumulatedScores) continue;

            for (const [dim, scoreStr] of Object.entries(session.accumulatedScores)) {
                const score = parseInt(scoreStr, 10);
                if (isNaN(score)) continue;

                dimensionsBreakdown[mod][dim] = (dimensionsBreakdown[mod][dim] || 0) + score;
                counts[mod][dim] = (counts[mod][dim] || 0) + 1;

                // Also aggregate into OVERALL
                dimensionsBreakdown['OVERALL'][dim] = (dimensionsBreakdown['OVERALL'][dim] || 0) + score;
                counts['OVERALL'][dim] = (counts['OVERALL'][dim] || 0) + 1;
            }
        }

        // Average the dimensions out
        for (const mod in dimensionsBreakdown) {
            for (const dim in dimensionsBreakdown[mod]) {
                dimensionsBreakdown[mod][dim] = Math.round(dimensionsBreakdown[mod][dim] / counts[mod][dim]);
            }
        }

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ userId, period, radarData: dimensionsBreakdown })
        };
    } catch (err) {
        diagnostics.error('getModuleStats failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Could not load module stats. Please try again.' }) };
    }
};
