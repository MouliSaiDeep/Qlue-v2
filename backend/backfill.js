const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const SESSIONS_TABLE = 'qlue-sessions';
const FEEDBACK_TABLE = 'qlue-feedback';

async function run() {
    console.log("Starting backfill of accumulatedScores from Feedback to Sessions...");
    
    // 1. Get all feedbacks
    const fbRes = await docClient.send(new ScanCommand({ TableName: FEEDBACK_TABLE }));
    const feedbacks = fbRes.Items || [];
    
    console.log(`Found ${feedbacks.length} feedbacks.`);
    
    let updated = 0;
    for (const fb of feedbacks) {
        if (!fb.sessionId || !fb.dimensionScores) continue;
        
        try {
            await docClient.send(new UpdateCommand({
                TableName: SESSIONS_TABLE,
                Key: { sessionId: fb.sessionId },
                UpdateExpression: "SET accumulatedScores = :as",
                ExpressionAttributeValues: {
                    ":as": fb.dimensionScores
                }
            }));
            updated++;
            console.log(`Successfully updated session ${fb.sessionId}`);
        } catch (e) {
            console.error(`Failed to update session ${fb.sessionId}:`, e.message);
        }
    }
    
    console.log(`Done. Updated ${updated} sessions.`);
}

run();
