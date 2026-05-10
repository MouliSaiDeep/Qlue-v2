const { performance } = require('perf_hooks');

let itemsFetchedCount = 0;

// Mocking AWS SDK v3
const mockDocClient = {
    send: async (command) => {
        // Simulate 100 items in transcript
        const allItems = [];
        for (let i = 0; i < 100; i++) {
            allItems.push({
                speaker: i % 2 === 0 ? 'USER' : 'AI',
                turnIndex: Math.floor(i / 2),
                text: 'test'
            });
        }

        let returnedItems;
        if (command.params.Limit) {
            // New implementation would use Limit
            if (command.params.ScanIndexForward === false) {
                returnedItems = allItems.slice().reverse().slice(0, command.params.Limit);
            } else {
                returnedItems = allItems.slice(0, command.params.Limit);
            }
        } else {
            // Current implementation fetches everything
            returnedItems = allItems;
        }

        itemsFetchedCount += returnedItems.length;
        return { Items: returnedItems };
    }
};

class MockQueryCommand {
    constructor(params) {
        this.params = params;
    }
}

// Current implementation of getTranscriptBySession
async function getTranscriptBySession_current(sessionId) {
    const command = new MockQueryCommand({
        TableName: 'qlue-transcripts',
        IndexName: 'GSI_SessionIdTurnIndex',
        KeyConditionExpression: 'sessionId = :sid',
        ExpressionAttributeValues: {
            ':sid': sessionId
        },
        ScanIndexForward: true
    });

    const result = await mockDocClient.send(command);
    return result.Items || [];
}

// Current implementation of getLastAiTurnIndex
async function getLastAiTurnIndex_current(sessionId, sessionTurnCount = 0) {
    try {
        const transcripts = await getTranscriptBySession_current(sessionId);
        for (let i = transcripts.length - 1; i >= 0; i--) {
            const item = transcripts[i];
            if (item.speaker === 'AI') {
                return Number(item.turnIndex) || 0;
            }
        }
    } catch (err) {
        // ignore
    }
    return Math.max(0, (sessionTurnCount || 1) - 1);
}

// Optimized implementation of getLatestTranscripts
async function getLatestTranscripts_optimized(sessionId, limit = 5) {
    const command = new MockQueryCommand({
        TableName: 'qlue-transcripts',
        IndexName: 'GSI_SessionIdTurnIndex',
        KeyConditionExpression: 'sessionId = :sid',
        ExpressionAttributeValues: {
            ':sid': sessionId
        },
        ScanIndexForward: false, // Descending
        Limit: limit
    });

    const result = await mockDocClient.send(command);
    return result.Items || [];
}

// Optimized implementation of getLastAiTurnIndex
async function getLastAiTurnIndex_optimized(sessionId, sessionTurnCount = 0) {
  try {
    const transcripts = await getLatestTranscripts_optimized(sessionId, 5);
    for (const item of transcripts) {
      if (item.speaker === 'AI') {
        return Number(item.turnIndex) || 0;
      }
    }
  } catch (err) {
    // ignore
  }
  return Math.max(0, (sessionTurnCount || 1) - 1);
}

async function runBenchmark() {
    const iterations = 1000;
    const sessionId = 'session-123';

    // Baseline
    itemsFetchedCount = 0;
    const startBaseline = performance.now();
    let resultBaseline;
    for (let i = 0; i < iterations; i++) {
        resultBaseline = await getLastAiTurnIndex_current(sessionId, 50);
    }
    const endBaseline = performance.now();
    const timeBaseline = endBaseline - startBaseline;
    const itemsBaseline = itemsFetchedCount;

    // Optimized
    itemsFetchedCount = 0;
    const startOptimized = performance.now();
    let resultOptimized;
    for (let i = 0; i < iterations; i++) {
        resultOptimized = await getLastAiTurnIndex_optimized(sessionId, 50);
    }
    const endOptimized = performance.now();
    const timeOptimized = endOptimized - startOptimized;
    const itemsOptimized = itemsFetchedCount;

    console.log(`BENCHMARK_RESULTS:`);
    console.log(`Iterations: ${iterations}`);
    console.log(`Session size: 100 items`);
    console.log(`\nBASELINE:`);
    console.log(`  Total time: ${timeBaseline.toFixed(2)}ms`);
    console.log(`  Avg time: ${(timeBaseline / iterations).toFixed(4)}ms`);
    console.log(`  Total items fetched: ${itemsBaseline}`);
    console.log(`  Last turn index: ${resultBaseline}`);

    console.log(`\nOPTIMIZED:`);
    console.log(`  Total time: ${timeOptimized.toFixed(2)}ms`);
    console.log(`  Avg time: ${(timeOptimized / iterations).toFixed(4)}ms`);
    console.log(`  Total items fetched: ${itemsOptimized}`);
    console.log(`  Last turn index: ${resultOptimized}`);

    console.log(`\nIMPROVEMENT:`);
    console.log(`  Time reduction: ${((1 - timeOptimized / timeBaseline) * 100).toFixed(2)}%`);
    console.log(`  I/O reduction: ${((1 - itemsOptimized / itemsBaseline) * 100).toFixed(2)}%`);

    if (resultBaseline !== resultOptimized) {
        console.error(`ERROR: Result mismatch! Baseline: ${resultBaseline}, Optimized: ${resultOptimized}`);
        process.exit(1);
    } else {
        console.log(`\nVERIFICATION: SUCCESS - results match.`);
    }
}

runBenchmark();
