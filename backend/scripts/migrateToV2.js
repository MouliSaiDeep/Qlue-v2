const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const MAX_BATCH_ITEMS = 25;
const MAX_BATCH_SIZE_BYTES = 16 * 1024 * 1024; // 16MB

function getSizeInBytes(obj) {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

/**
 * Generic backfill function
 */
async function backfillTable(sourceTableName, destTableName, itemTransformer) {
    if (!sourceTableName || !destTableName) {
        console.warn(`Skipping backfill: source (${sourceTableName}) or dest (${destTableName}) table name missing`);
        return;
    }
    console.log(`Starting backfill from ${sourceTableName} to ${destTableName}`);
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

            const requestObj = { PutRequest: { Item: transformedItem } };
            const itemSize = getSizeInBytes(requestObj);

            // Check if adding this item exceeds batch limits
            if (currentBatch.length >= MAX_BATCH_ITEMS || (currentBatchSize + itemSize) >= MAX_BATCH_SIZE_BYTES) {
                // Send current batch
                await writeBatch(destTableName, currentBatch);
                totalMigrated += currentBatch.length;
                
                // Reset batch
                currentBatch = [];
                currentBatchSize = 0;
            }

            currentBatch.push(requestObj);
            currentBatchSize += itemSize;
        }

        // Flush remaining
        if (currentBatch.length > 0) {
            await writeBatch(destTableName, currentBatch);
            totalMigrated += currentBatch.length;
        }

        lastEvaluatedKey = scanRes.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`Finished migrating ${totalMigrated} items to ${destTableName}`);
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

// Transformation Logic
async function migrate() {
    // 1. Users
    await backfillTable(process.env.USERS_TABLE, process.env.USERS_TABLE_V2, async (user) => {
        const u = { ...user, profileKey: "PROFILE" };
        if (u.provider) u.authProviderKey = `PROVIDER#${u.provider.toUpperCase()}`;
        return u;
    });

    // 2. Resumes
    await backfillTable(process.env.RESUMES_TABLE, process.env.RESUMES_TABLE_V2, async (resume) => {
        const r = { ...resume, resumeKey: `RESUME#${resume.uploadedAt}#${resume.resumeId}` };
        if (resume.isActive) r.activeResumeKey = `ACTIVE#${resume.resumeId}`;
        return r;
    });

    // 3. Sessions (Needs to merge Concept States)
    await backfillTable(process.env.SESSIONS_TABLE, process.env.SESSIONS_TABLE_V2, async (session) => {
        const s = { 
            ...session, 
            sessionKey: `SESSION#${session.sessionId}`, 
            startedAt: session.startTime || new Date().toISOString() 
        };
        if (s.activeMarker === "ACTIVE") s.statusKey = `active#${s.startedAt}`;
        
        // Merge concept states if available
        try {
            const conceptsTable = process.env.CONCEPT_STATES_TABLE || 'qlue-concept-states';
            const concepts = await docClient.send(new ScanCommand({
                TableName: conceptsTable,
                FilterExpression: "sessionId = :sid",
                ExpressionAttributeValues: { ":sid": session.sessionId }
            }));
            
            if (concepts.Items && concepts.Items.length > 0) {
                s.conceptStates = s.conceptStates || {};
                for (const c of concepts.Items) {
                    s.conceptStates[c.conceptId || c.concept] = { 
                        state: c.state || c.status, 
                        attempts: c.attempts || 1,
                        lastSeen: c.updatedAt || c.timestamp
                    };
                }
            }
        } catch (e) {
            console.error(`Failed to fetch concept states for session ${session.sessionId}`, e.message);
        }
        
        return s;
    });

    // 4. Transcripts
    await backfillTable(process.env.TRANSCRIPTS_TABLE, process.env.TRANSCRIPTS_TABLE_V2, async (transcript) => {
        const t = { 
            ...transcript, 
            turnKey: `TURN#${String(transcript.turnIndex).padStart(4, '0')}`,
            createdAt: transcript.timestamp || new Date().toISOString()
        };
        if (t.module && t.concept) {
            t.moduleConcept = `${t.module}#${t.concept}`;
            t.conceptKey = `${t.difficulty || 'MEDIUM'}#${t.createdAt}`;
        }
        return t;
    });

    // 5. Feedback
    await backfillTable(process.env.FEEDBACK_TABLE, process.env.FEEDBACK_TABLE_V2, async (feedback) => {
        const f = { ...feedback, feedbackKey: `FEEDBACK#v1` };
        if (f.overallScore) {
            f.ratingKey = "SCORE#OVERALL";
            f.ratingScore = f.overallScore;
        }
        return f;
    });

    // 6. Notifications
    await backfillTable(process.env.NOTIFICATIONS_TABLE, process.env.NOTIFICATIONS_TABLE_V2, async (notif) => {
        const n = { ...notif, notificationKey: `NOTIF#${notif.sentAt}#${notif.notificationId}` };
        if (!n.isRead) n.unreadKey = `false#${n.sentAt}`;
        return n;
    });

    // 7. WS Connections
    await backfillTable(process.env.WS_CONNECTIONS_TABLE, process.env.WS_CONNECTIONS_TABLE_V2, async (conn) => {
        const c = { ...conn, connectionKey: `CONN#${conn.connectedAt}#${conn.connectionId}` };
        return c;
    });
}

if (require.main === module) {
    // Load env vars if running locally for testing, but typically run via Lambda/SAM
    migrate().catch(console.error);
}

module.exports = { migrate };
