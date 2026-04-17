const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE_NAME || 'Sessions';

function getCutoffDate(periodStr) {
    const now = new Date();
    if (periodStr === '7d') now.setDate(now.getDate() - 7);
    else if (periodStr === '30d') now.setDate(now.getDate() - 30);
    else if (periodStr === '90d') now.setDate(now.getDate() - 90);
    else return null; 
    return now.toISOString();
}

exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.claims?.sub || event.queryStringParameters?.userId;
        const period = event.queryStringParameters?.period || '30d';

        if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };

        const cutoff = getCutoffDate(period);
        
        let keyCond = 'userId = :uid';
        const expVals = { ':uid': userId };

        if (cutoff) {
            keyCond += ' AND startTime >= :cutoff';
            expVals[':cutoff'] = cutoff;
        }

        const sessionCmd = new QueryCommand({
            TableName: SESSIONS_TABLE,
            IndexName: 'UserDateIndex',
            KeyConditionExpression: keyCond,
            ExpressionAttributeValues: expVals
        });

        const res = await docClient.send(sessionCmd);
        const sessions = res.Items || [];

        // Radar Chart Data aggregation
        const dimensionsBreakdown = {
            RESUME: {},
            WEBSITE: {},
            HR: {}
        };
        const counts = { RESUME: {}, WEBSITE: {}, HR: {} };

        for (const session of sessions) {
            const mod = session.moduleType;
            if (!mod || !dimensionsBreakdown[mod] || !session.accumulatedScores) continue;

            for (const [dim, scoreStr] of Object.entries(session.accumulatedScores)) {
                const score = parseInt(scoreStr, 10);
                if (isNaN(score)) continue;

                dimensionsBreakdown[mod][dim] = (dimensionsBreakdown[mod][dim] || 0) + score;
                counts[mod][dim] = (counts[mod][dim] || 0) + 1;
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
        console.error('getModuleStats failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
