const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const MAX_BATCH_ITEMS = 25;
const MAX_BATCH_SIZE_BYTES = 16 * 1024 * 1024; // 16MB

function getSizeInBytes(obj) {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

async function rollbackTable(sourceTableName, destTableName, itemTransformer) {
    console.log(`Starting rollback from ${sourceTableName} to ${destTableName}`);
    let lastEvaluatedKey = undefined;
    let totalMigrated = 0;

    do {
        const scanRes = await docClient.send(new ScanCommand({
            TableName: sourceTableName,
            ExclusiveStartKey: lastEvaluatedKey
        }));

        const items = scanRes.Items || [];
        if (items.length === 0) break;

        let currentBatch = [];
        let currentBatchSize = 0;

        for (const item of items) {
            const transformedItem = await itemTransformer(item);
            if (!transformedItem) continue;

            // Handle multiple items if conceptStates was flattened
            const requests = Array.isArray(transformedItem) ? transformedItem : [transformedItem];

            for (const reqItem of requests) {
                const requestObj = { PutRequest: { Item: reqItem } };
                const itemSize = getSizeInBytes(requestObj);

                if (currentBatch.length >= MAX_BATCH_ITEMS || (currentBatchSize + itemSize) >= MAX_BATCH_SIZE_BYTES) {
                    await writeBatch(destTableName, currentBatch);
                    totalMigrated += currentBatch.length;
                    currentBatch = [];
                    currentBatchSize = 0;
                }

                currentBatch.push(requestObj);
                currentBatchSize += itemSize;
            }
        }

        if (currentBatch.length > 0) {
            await writeBatch(destTableName, currentBatch);
            totalMigrated += currentBatch.length;
        }

        lastEvaluatedKey = scanRes.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`Finished rolling back ${totalMigrated} items to ${destTableName}`);
}

async function writeBatch(tableName, requestItems) {
    let unprocessed = { [tableName]: requestItems };
    let retries = 0;
    
    while (Object.keys(unprocessed).length > 0 && retries < 3) {
        const res = await docClient.send(new BatchWriteCommand({
            RequestItems: unprocessed
        }));
        
        unprocessed = res.UnprocessedItems || {};
        if (Object.keys(unprocessed).length > 0) {
            retries++;
            await new Promise(r => setTimeout(r, Math.pow(2, retries) * 100));
        }
    }
    
    if (Object.keys(unprocessed).length > 0) {
        console.error("Failed to write some items after 3 retries", unprocessed);
    }
}

async function rollback() {
    // 1. Users
    await rollbackTable(process.env.USERS_TABLE_V2, process.env.USERS_TABLE, async (user) => {
        const { profileKey, ...oldUser } = user;
        return oldUser;
    });

    // 2. Resumes
    await rollbackTable(process.env.RESUMES_TABLE_V2, process.env.RESUMES_TABLE, async (resume) => {
        const { resumeKey, activeResumeKey, ...oldResume } = resume;
        return oldResume;
    });

    // 3. Sessions & ConceptStates
    // We must return an array of items here if we are splitting back out concept states.
    // However, BatchWriteItem only targets one table per call in our writeBatch function.
    // So we'll rollback sessions first, then concept states manually.
    await rollbackTable(process.env.SESSIONS_TABLE_V2, process.env.SESSIONS_TABLE, async (session) => {
        const { sessionKey, statusKey, startedAt, conceptStates, ...oldSession } = session;
        return oldSession;
    });

    // Concept States rollback (extracting from V2 Sessions)
    await rollbackTable(process.env.SESSIONS_TABLE_V2, process.env.CONCEPTS_TABLE_NAME, async (session) => {
        if (!session.conceptStates) return null;
        const conceptItems = [];
        for (const [conceptId, data] of Object.entries(session.conceptStates)) {
            conceptItems.push({
                conceptId,
                sessionId: session.sessionId,
                state: data.state,
                attempts: data.attempts
            });
        }
        return conceptItems;
    });

    // 4. Transcripts
    await rollbackTable(process.env.TRANSCRIPTS_TABLE_V2, process.env.TRANSCRIPTS_TABLE, async (transcript) => {
        const { turnKey, ...oldTranscript } = transcript;
        return oldTranscript;
    });

    // 5. Feedback
    await rollbackTable(process.env.FEEDBACK_TABLE_V2, process.env.FEEDBACK_TABLE, async (feedback) => {
        const { feedbackKey, feedbackStatusKey, ...oldFeedback } = feedback;
        return oldFeedback;
    });

    // 6. Notifications
    await rollbackTable(process.env.NOTIFICATIONS_TABLE_V2, process.env.NOTIFICATIONS_TABLE, async (notif) => {
        const { notificationKey, unreadKey, ...oldNotif } = notif;
        return oldNotif;
    });
}

if (require.main === module) {
    rollback().catch(console.error);
}

module.exports = { rollback };
