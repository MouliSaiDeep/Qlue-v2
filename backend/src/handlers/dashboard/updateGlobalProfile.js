const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { invokeModel } = require('../../lib/bedrock');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'qlue-feedback';
const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';
const MODEL_ID = process.env.NEMOTRON_MODEL_ID || 'nvidia.nemotron-super-3-120b';

exports.handler = async (event) => {
    try {
        console.log(`Processing ${event.Records.length} stream records...`);
        
        // We might get multiple records, but usually 1 per batch if configured that way
        const uniqueUserIds = new Set();
        
        for (const record of event.Records) {
            if (record.eventName === 'INSERT') {
                const newImage = record.dynamodb.NewImage;
                if (newImage && newImage.userId && newImage.userId.S) {
                    uniqueUserIds.add(newImage.userId.S);
                }
            }
        }

        for (const userId of uniqueUserIds) {
            console.log(`Aggregating insights for user: ${userId}`);
            
            // 1. Fetch last 5 feedbacks
            const feedbackCmd = new QueryCommand({
                TableName: FEEDBACK_TABLE,
                IndexName: 'GSI_UserIdGeneratedAt',
                KeyConditionExpression: 'userId = :uid',
                ExpressionAttributeValues: { ':uid': userId },
                ScanIndexForward: false, // Latest first
                Limit: 5
            });

            const feedbackData = await docClient.send(feedbackCmd);
            const recentFeedbacks = feedbackData.Items || [];

            if (recentFeedbacks.length === 0) continue;

            // 2. Format the payload for Nemotron
            const compiledContext = recentFeedbacks.map((fb, idx) => {
                return `Session ${idx + 1}:
Strengths: ${(fb.strengths || []).join(', ')}
Weaknesses: ${(fb.weaknesses || fb.improvements || []).join(', ')}
Summary: ${fb.executiveSummary || fb.summary || ''}`;
            }).join('\n\n');

            const systemPrompt = `You are Qlue, an elite AI interview coach. Your task is to analyze the user's past interview sessions and provide a high-level summary.
You must synthesize exactly 3 overarching strengths, exactly 3 overarching areas for improvement, and 1 highly actionable executive coaching tip.
Do not use markdown blocks. Output MUST be a raw JSON object matching this schema:
{
  "strengths": ["string", "string", "string"],
  "improvements": ["string", "string", "string"],
  "tip": "string"
}`;

            const messages = [
                {
                    role: 'user',
                    content: [{ text: `Here are the coaching notes from the last ${recentFeedbacks.length} interview sessions:\n<feedback>\n${compiledContext}\n</feedback>\n\nSynthesize this into the final JSON output.` }]
                }
            ];

            // 3. Invoke Nemotron via Bedrock
            console.log(`Invoking Nemotron model ${MODEL_ID} for synthesis...`);
            const response = await invokeModel(MODEL_ID, {
                messages,
                system: systemPrompt,
                temperature: 0.2,
                max_tokens: 600
            });

            const rawContent = response.content[0].text;
            let parsedInsights;
            try {
                // Strip potential markdown wrappers just in case Nemotron adds them despite instructions
                const cleanedJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
                parsedInsights = JSON.parse(cleanedJson);
            } catch (parseErr) {
                console.error("Failed to parse Nemotron JSON output:", rawContent);
                // Fallback to latest feedback if JSON is completely garbled
                parsedInsights = {
                    strengths: recentFeedbacks[0].strengths || [],
                    improvements: recentFeedbacks[0].weaknesses || recentFeedbacks[0].improvements || [],
                    tip: recentFeedbacks[0].executiveSummary || recentFeedbacks[0].summary || ""
                };
            }

            // 4. Save to UsersTable
            const updateCmd = new UpdateCommand({
                TableName: USERS_TABLE,
                Key: { userId: userId },
                UpdateExpression: "SET globalInsights = :gi",
                ExpressionAttributeValues: {
                    ":gi": parsedInsights
                }
            });
            await docClient.send(updateCmd);
            console.log(`Successfully updated globalInsights for user: ${userId}`);
        }

        return { statusCode: 200, body: "Success" };
    } catch (err) {
        console.error('updateGlobalProfile Failed:', err);
        throw err; // Throw to allow DynamoDB Stream to retry
    }
};
