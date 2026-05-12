const { handler } = require("./src/handlers/dashboard/updateGlobalProfile");

async function run() {
    console.log("Triggering global profile update manually...");
    
    // We mock a DynamoDB stream event. 
    // updateGlobalProfile looks for event.Records[0].dynamodb.NewImage.userId.S
    // We just need to pass the user ID from the user's environment.
    // Wait, the user ID is in the SESSIONS_TABLE. I will pull the user ID from the first feedback.

    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
    const client = new DynamoDBClient({ region: 'us-east-1' });
    const docClient = DynamoDBDocumentClient.from(client);

    const fbRes = await docClient.send(new ScanCommand({ TableName: 'qlue-feedback', Limit: 1 }));
    const userId = fbRes.Items[0].userId;

    console.log("Found userId:", userId);

    const mockEvent = {
        Records: [
            {
                eventName: 'INSERT',
                dynamodb: {
                    NewImage: {
                        userId: { S: userId }
                    }
                }
            }
        ]
    };

    try {
        await handler(mockEvent);
        console.log("Successfully ran updateGlobalProfile.js");
    } catch(e) {
        console.error("Failed:", e);
    }
}

run();
