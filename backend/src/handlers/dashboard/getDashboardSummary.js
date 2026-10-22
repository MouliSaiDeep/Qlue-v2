const diagnostics=require('../../lib/logger').safeConsole;
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { queryAllItems } = require('../../lib/paginate');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'qlue-feedback';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';
const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

/**
 * Calculates a unified integer score from the accumulatedScores object.
 */
function calculateAggregateScore(accumulatedScores, assessmentOverallScore) {
    if (Number.isFinite(assessmentOverallScore)) return Math.round(assessmentOverallScore);
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
        // SECURITY: no ?userId= fallback — it let any signed-in user read
        // another user's dashboard.
        const userId = auth?.uid || auth?.claims?.sub || auth?.principalId;
        if (!userId) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized. User ID missing.' }) };
        }

        // Prepare Query Commands
        // PERF-FIX #9: Project only the two attributes the aggregation needs.
        // Session items carry itemData (resume summaries, scraped website
        // content, etc.), so an unprojected query transferred kilobytes per
        // session that were immediately discarded.
        // BE-BUG #18 FIX: aggregate over EVERY page (queryAllItems), not just
        // the first 1MB — otherwise heavy users' totals/averages were truncated.
        const sessionParams = {
            TableName: SESSIONS_TABLE,
            IndexName: 'GSI_UserIdStartedAt',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': userId
            },
            ProjectionExpression: 'moduleType, accumulatedScores, assessmentOverallScore, discarded'
        };

        const userCmd = new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: userId }
        });

        // Execute Queries Concurrently
        const [allSessions, userData] = await Promise.all([
            queryAllItems(docClient, sessionParams),
            require('../../lib/deadline').sendBounded(docClient,userCmd)
        ]);

        const sessions = allSessions.filter(x => !x.discarded); // discarded sessions never count
        const userProfile = userData.Item || null;
        const globalInsights = userProfile?.globalInsights || null;

        // Metrics Accumulators
        let totalSessions = sessions.length;
        // JD added: job-match sessions counted toward totals but were invisible
        // in the per-module breakdown and best-score tiles.
        let moduleBreakdown = { RESUME: 0, HR: 0, WEBSITE: 0, INTRO: 0, JD: 0 };
        let bestScoreByModule = { RESUME: 0, HR: 0, WEBSITE: 0, INTRO: 0, JD: 0 };
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
                const aggrScore = calculateAggregateScore(session.accumulatedScores, session.assessmentOverallScore);
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
        diagnostics.error('getDashboardSummary Failed:', err);
        // Detail stays in CloudWatch; clients get a generic message so internal
        // table names and SDK errors are not echoed back over the API.
        return { statusCode: 500, body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Could not load your dashboard. Please try again.' }) };
    }
};
