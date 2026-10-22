const { docClient } = require('../lib/dynamodb');
const { PutCommand, QueryCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { createHash } = require('node:crypto');

const TRANSCRIPTS_TABLE = process.env.TRANSCRIPTS_TABLE || 'qlue-transcripts';

const SPEAKERS = {
    USER: 'USER',
    AI: 'AI'
};

// I-08: within a single logical turn both the USER answer and the following AI
// question share the same turnIndex. The GSI sorts by turnIndex ONLY, so two
// entries at the same turnIndex came back in an unspecified (and under index
// lag, unstable) order — the prompt and the saved report could show the AI
// question before the answer it was responding to. A stable per-speaker rank
// gives every entry an unambiguous ordered sequence: USER always precedes the
// AI turn it produced.
const SPEAKER_RANK = { USER: 0, AI: 1 };

function speakerRank(speaker) {
    return SPEAKER_RANK[speaker] !== undefined ? SPEAKER_RANK[speaker] : 2;
}

// Deterministic ordered sequence key for a transcript entry:
//   "000001#0#USER" sorts before "000001#1#AI".
// turnIndex is zero-padded so lexicographic order matches numeric turn order.
function seqFor(turnIndex, speaker) {
    const idx = Number.isFinite(turnIndex) ? turnIndex : 0;
    return `${String(idx).padStart(6, '0')}#${speakerRank(speaker)}#${speaker || ''}`;
}

// The effective sequence of a row: the stored `seq` for entries written since
// I-08, or a synthesized one for legacy rows that predate it (so old and new
// rows interleave correctly in a mixed transcript).
function effectiveSeq(t) {
    return t.seq || seqFor(t.turnIndex, t.speaker);
}

// A numeric creation time for a deterministic tie-break: the numeric `createdAt`
// written since I-08, else the parsed ISO `timestamp`, else 0. Never NaN — the
// legacy getSessionDetail sort subtracted ISO strings and produced NaN, so a
// freshly-added row could land anywhere.
function createdAtOf(t) {
    if (Number.isFinite(t.createdAt)) return t.createdAt;
    const parsed = Date.parse(t.timestamp);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * I-08: the single shared transcript comparator. Orders by the deterministic
 * sequence (turnIndex, then USER before AI within a turn), falling back to
 * creation time and finally the transcriptId so the order is total and stable
 * even for legacy rows and duplicate deliveries. Used everywhere a transcript is
 * ordered for a prompt, a report, or the dashboard, replacing several ad-hoc
 * (and NaN-prone) sorts.
 */
function compareTranscripts(a, b) {
    const sa = effectiveSeq(a);
    const sb = effectiveSeq(b);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    const ca = createdAtOf(a);
    const cb = createdAtOf(b);
    if (ca !== cb) return ca - cb;
    return String(a.transcriptId || '').localeCompare(String(b.transcriptId || ''));
}

/**
 * Saves a transcript entry to DynamoDB.
 *
 * I-08: entries now carry a deterministic ordered `seq` and a numeric `createdAt`,
 * and the item's id is derived from (sessionId, turnIndex, speaker) so a
 * duplicate delivery of the SAME logical message (SQS at-least-once; the app's
 * WS+REST double-fire) is idempotent rather than a second, order-ambiguous row.
 * The 4-arg signature is unchanged — the ordering fields are computed internally.
 */
function buildTranscript(sessionId, turnIndex, speaker, text, options = {}) {
    const seq = seqFor(turnIndex, speaker);
    return {
        // Deterministic id = one slot per logical message, so an at-least-once
        // redelivery conditionally fails below instead of duplicating the entry.
        transcriptId: `${sessionId}#${seq}#${options.eventId || createHash('sha256').update(String(text)).digest('hex').slice(0, 24)}`,
        eventId: options.eventId || createHash('sha256').update(String(text)).digest('hex').slice(0, 24),
        sessionId,
        turnIndex,
        seq,
        speaker,
        text,
        ...(speaker === 'USER' && options.asr ? {asr:options.asr} : {}),
        createdAt: Date.now(),
        timestamp: new Date().toISOString()
    };

}

async function saveTranscript(sessionId, turnIndex, speaker, text, options = {}) {
    const transcript = buildTranscript(sessionId, turnIndex, speaker, text, options);

    const command = new PutCommand({
        TableName: TRANSCRIPTS_TABLE,
        Item: transcript,
        // Idempotent write: a redelivery of the same (session, turn, speaker)
        // message is a no-op rather than a duplicate/clobber.
        ConditionExpression: 'attribute_not_exists(transcriptId)'
    });

    try {
        const session = await require('./session').getSessionById(sessionId);
        if (!session?.userId) throw new Error('Transcript parent no longer exists');
        const checks = { TableName: process.env.SESSIONS_TABLE || 'qlue-sessions', Key:{sessionId},
          ConditionExpression:'attribute_exists(sessionId) AND currentState <> :terminated AND currentState <> :feedback',
          ExpressionAttributeValues:{':terminated':'TERMINATED',':feedback':'GENERATING_FEEDBACK'} };
        if (options.expectedLeaseOwner) {
          checks.ConditionExpression += ' AND leaseOwner = :owner AND leaseVersion = :version';
          checks.ExpressionAttributeValues[':owner']=options.expectedLeaseOwner;
          checks.ExpressionAttributeValues[':version']=options.expectedLeaseVersion;
        }
        await require('../lib/dynamodb').fencedSend(command, session.userId, [{ConditionCheck:checks}]);
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
            // Already saved (duplicate delivery) — treat as success.
            const existing = await require('../lib/deadline').sendBounded(docClient,new GetCommand({TableName:TRANSCRIPTS_TABLE,Key:{transcriptId:transcript.transcriptId},ConsistentRead:true}));
            if (existing.Item && existing.Item.text === text) return existing.Item;
            throw err;
        }
        throw err;
    }
    return transcript;
}

/**
 * Retrieves the full transcript for a session, ordered chronologically.
 * I-08: paginates the GSI (a single Query page caps at 1MB, so a long interview
 * was silently truncated) and applies the shared comparator so same-turnIndex
 * USER/AI pairs are always ordered USER-before-AI.
 */
async function getTranscriptBySession(sessionId) {
    const items = [];
    let exclusiveStartKey;
    do {
        const result = await require('../lib/deadline').sendBounded(docClient,new QueryCommand({
            TableName: TRANSCRIPTS_TABLE,
            IndexName: 'GSI_SessionIdTurnIndex',
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: { ':sid': sessionId },
            ScanIndexForward: true, // Ascending by turnIndex
            ExclusiveStartKey: exclusiveStartKey
        }));
        if (result.Items) items.push(...result.Items);
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items.sort(compareTranscripts);
}

/**
 * Retrieves the most recent transcripts for a session, ordered by turnIndex descending.
 * Useful for finding the last AI turn or a small window of history efficiently.
 */
async function getLatestTranscripts(sessionId, limit = 5) {
    const command = new QueryCommand({
        TableName: TRANSCRIPTS_TABLE,
        IndexName: 'GSI_SessionIdTurnIndex',
        KeyConditionExpression: 'sessionId = :sid',
        ExpressionAttributeValues: {
            ':sid': sessionId
        },
        ScanIndexForward: false, // Descending by turnIndex
        Limit: limit
    });

    const result = await require('../lib/deadline').sendBounded(docClient,command);
    return result.Items || [];
}

/**
 * PERF-FIX #3: Efficient LLM context window fetch.
 * Previously the async worker fetched the FULL transcript on every turn and
 * truncated in memory. This queries only the most recent `maxMessages` items
 * (descending), then orders them with the shared comparator. If the window no
 * longer reaches the start of the session, the very first turn is fetched
 * separately and pinned to the front, preserving the original "first message +
 * recent" truncation behaviour at a fraction of the read cost.
 *
 * I-08: ordering uses compareTranscripts rather than a plain reverse, so a
 * USER answer and the AI turn that share a turnIndex are deterministically
 * USER-before-AI even when the GSI returns equal-turnIndex items out of order.
 */
async function getContextWindow(sessionId, maxMessages = 20) {
    const recentDesc = await getLatestTranscripts(sessionId, maxMessages);
    const window = recentDesc.slice().sort(compareTranscripts); // chronological, stable

    if (window.length === 0) return [];

    const earliestFetchedTurn = window[0].turnIndex || 0;
    if (window.length === maxMessages && earliestFetchedTurn > 0) {
        // Pin the opening exchange so the model keeps the interview framing.
        const firstCommand = new QueryCommand({
            TableName: TRANSCRIPTS_TABLE,
            IndexName: 'GSI_SessionIdTurnIndex',
            KeyConditionExpression: 'sessionId = :sid',
            ExpressionAttributeValues: { ':sid': sessionId },
            ScanIndexForward: true,
            Limit: 1
        });
        const firstResult = await require('../lib/deadline').sendBounded(docClient,firstCommand);
        const first = firstResult.Items?.[0];
        if (first) {
            // Drop the oldest item in the window to keep size at maxMessages.
            return [first, ...window.slice(1)];
        }
    }

    return window;
}

module.exports = {
    buildTranscript,
    SPEAKERS,
    SPEAKER_RANK,
    saveTranscript,
    getTranscriptBySession,
    getLatestTranscripts,
    getContextWindow,
    compareTranscripts,
    seqFor
};
