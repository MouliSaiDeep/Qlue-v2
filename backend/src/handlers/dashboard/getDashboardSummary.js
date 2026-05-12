const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'qlue-feedback';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';
const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

/**
 * Calculates a unified integer score from the accumulatedScores object.
 */
function calculateAggregateScore(accumulatedScores) {
    if (!accumulatedScores || Object.keys(accumulatedScores).length === 0) return 0;
    
    let totalScore = 0;
    let items = 0;
    for (const val of Object.values(accumulatedScores)) {
        totalScore += parseInt(val, 10);
        items++;
    }
    return Math.round(totalScore / items);
}

/**
 * Poorna (P) - Day 15: getDashboardSummary
 * Retrieves and computes the personal performance statistics for the logged-in user.
 */
exports.handler = async (event) => {
    try {
        // Resolve userId from the Custom Authorizer context
        const auth = event.requestContext?.authorizer;
        const userId = auth?.uid || auth?.claims?.sub || event.queryStringParameters?.userId;
        if (!userId) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized. User ID missing.' }) };
        }

        // Prepare Query Commands
        const sessionCmd = new QueryCommand({
            TableName: SESSIONS_TABLE,
            IndexName: 'GSI_UserIdStartedAt',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': userId
            }
        });

        const userCmd = new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: userId }
        });

        // Execute Queries Concurrently
        const [sessionData, userData] = await Promise.all([
            docClient.send(sessionCmd),
            docClient.send(userCmd)
        ]);

        const sessions = sessionData.Items || [];
        const userProfile = userData.Item || null;
        const globalInsights = userProfile?.globalInsights || null;

        // Metrics Accumulators
        let totalSessions = sessions.length;
        let moduleBreakdown = { RESUME: 0, HR: 0, WEBSITE: 0, INTRO: 0 };
        let bestScoreByModule = { RESUME: 0, HR: 0, WEBSITE: 0, INTRO: 0 };
        let scoresArray = [];
        let completedSessions = 0;

        // Process Data
        for (const session of sessions) {
            // Module Distribution
            if (session.moduleType && moduleBreakdown[session.moduleType] !== undefined) {
                moduleBreakdown[session.moduleType]++;
            }

            // Only score sessions that generated metrics
            if (session.accumulatedScores && Object.keys(session.accumulatedScores).length > 0) {
                const aggrScore = calculateAggregateScore(session.accumulatedScores);
                scoresArray.push(aggrScore);
                completedSessions++;
                
                if (session.moduleType && bestScoreByModule[session.moduleType] !== undefined) {
                    if (aggrScore > bestScoreByModule[session.moduleType]) {
                        bestScoreByModule[session.moduleType] = aggrScore;
                    }
                }
            }
        }

        // Compute Aggregations
        const bestScore = scoresArray.length > 0 ? Math.max(...scoresArray) : 0;
        const sumScores = scoresArray.reduce((acc, curr) => acc + curr, 0);
        const averageScore = completedSessions > 0 ? Math.round(sumScores / completedSessions) : 0;

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId,
                summary: {
                    totalSessions,
                    completedSessions,
                    averageScore,
                    bestScore,
                    bestScoreByModule,
                    moduleBreakdown,
                    latestFeedback: globalInsights ? {
                        strengths: globalInsights.strengths || [],
                        improvements: globalInsights.improvements || [],
                        tip: globalInsights.tip || ""
                    } : null
                }
            })
        };

    } catch (err) {
        console.error('getDashboardSummary Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
