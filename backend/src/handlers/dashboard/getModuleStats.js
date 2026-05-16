const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

<<<<<<< HEAD
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions'; // BE-BUG #11 FIX
=======
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66

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
        const userId = event.requestContext?.authorizer?.claims?.sub || event.queryStringParameters?.userId || event.requestContext?.authorizer?.uid;
        const period = event.queryStringParameters?.period || '30d';

        if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };

        const cutoff = getCutoffTimestamp(period);
        
        let keyCond = 'userId = :uid';
        const expVals = { ':uid': userId };

        if (cutoff) {
            keyCond += ' AND startedAt >= :cutoff';
            expVals[':cutoff'] = cutoff;
        }

        const sessionCmd = new QueryCommand({
            TableName: SESSIONS_TABLE,
            IndexName: 'GSI_UserIdStartedAt',
            KeyConditionExpression: keyCond,
            ExpressionAttributeValues: expVals
        });

        const res = await docClient.send(sessionCmd);
        const sessions = res.Items || [];

        // Radar Chart Data aggregation
        const dimensionsBreakdown = {
            OVERALL: {},
            RESUME: {},
            WEBSITE: {},
            HR: {},
            INTRO: {}
        };
<<<<<<< HEAD
        const counts = { RESUME: {}, WEBSITE: {}, HR: {}, INTRO: {} };
=======
        const counts = { OVERALL: {}, RESUME: {}, WEBSITE: {}, HR: {}, INTRO: {} };
>>>>>>> 1e8157a87ed96695a80b02d223aec303f3216a66

        for (const session of sessions) {
            const mod = (session.moduleType || "").toUpperCase();
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

        // Average the dimensions out per module
        for (const mod in dimensionsBreakdown) {
            for (const dim in dimensionsBreakdown[mod]) {
                dimensionsBreakdown[mod][dim] = Math.round(dimensionsBreakdown[mod][dim] / counts[mod][dim]);
            }
        }

        // Build OVERALL by averaging all non-empty module dimension scores
        const overallScores = {};
        const overallCounts = {};
        for (const mod of ['RESUME', 'HR', 'WEBSITE', 'INTRO']) {
            for (const [dim, score] of Object.entries(dimensionsBreakdown[mod])) {
                overallScores[dim] = (overallScores[dim] || 0) + score;
                overallCounts[dim] = (overallCounts[dim] || 0) + 1;
            }
        }
        const overall = {};
        for (const dim in overallScores) {
            overall[dim] = Math.round(overallScores[dim] / overallCounts[dim]);
        }
        dimensionsBreakdown['OVERALL'] = overall;

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ userId, period, radarData: dimensionsBreakdown })
        };
    } catch (err) {
        console.error('getModuleStats failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
