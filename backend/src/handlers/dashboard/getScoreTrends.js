const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const CORE_TABLE = process.env.CORE_TABLE;

function getCutoffDate(periodStr) {
    const now = new Date();
    if (periodStr === '7d') now.setDate(now.getDate() - 7);
    else if (periodStr === '30d') now.setDate(now.getDate() - 30);
    else if (periodStr === '90d') now.setDate(now.getDate() - 90);
    else return null; 
    return now.toISOString();
}

function calculateAggregateScore(scoresObj) {
    if (!scoresObj || Object.keys(scoresObj).length === 0) return 0;
    let total = 0, count = 0;
    for (const v of Object.values(scoresObj)) { total += parseInt(v, 10); count++; }
    return Math.round(total / count);
}

exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.claims?.sub || event.queryStringParameters?.userId;
        const period = event.queryStringParameters?.period || '30d';

        if (!userId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };

        const cutoff = getCutoffDate(period);
        
        let keyCond = 'GSI1PK = :pk';
        const expVals = { ':pk': `USER#${userId}` };

        if (cutoff) {
            keyCond += ' AND GSI1SK >= :cutoffSK';
            expVals[':cutoffSK'] = `SESSION#${cutoff}`;
        } else {
            keyCond += ' AND begins_with(GSI1SK, :skPrefix)';
            expVals[':skPrefix'] = 'SESSION#';
        }

        const sessionCmd = new QueryCommand({
            TableName: CORE_TABLE,
            IndexName: 'GSI1',
            KeyConditionExpression: keyCond,
            ExpressionAttributeValues: expVals
        });

        const res = await docClient.send(sessionCmd);
        const sessions = res.Items || [];

        // Formatting for UI Trend Line
        const trends = sessions
            .filter(s => s.accumulatedScores && Object.keys(s.accumulatedScores).length > 0)
            .map(s => ({
                sessionId: s.sessionId,
                date: s.startedAt,
                moduleType: s.moduleType,
                score: calculateAggregateScore(s.accumulatedScores)
            }));

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ userId, period, trends })
        };
    } catch (err) {
        console.error('getScoreTrends failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
