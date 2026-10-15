/**
 * I-08 regression: deterministic transcript ordering + idempotent writes.
 *
 * Exercises the REAL models/transcript module against a mocked docClient (the
 * perfFixes pattern), so the shared comparator, the conditional/ idempotent
 * write, and the paginated read are all verified end to end.
 *
 * Defects this pins (previously ASSERTED to exist by the offline probe):
 *   - USER and AI entries share a turnIndex with no deterministic sub-order, so
 *     a report / prompt could show the AI question before the answer.
 *   - Legacy rows were ordered by subtracting ISO strings -> NaN -> any order.
 *   - A single Query page (1MB) silently truncated long interviews.
 *   - At-least-once delivery (SQS retries; the app's WS+REST double-fire) wrote
 *     duplicate transcript rows.
 */
const { docClient } = require('../../src/lib/dynamodb');
const transcript = require('../../src/models/transcript');
const {
    compareTranscripts,
    seqFor,
    saveTranscript,
    getTranscriptBySession
} = transcript;

beforeEach(() => {
    jest.clearAllMocks();
    // transcript.js captured docClient by reference at require time; replacing
    // .send on the shared instance mocks every DynamoDB call it makes.
    docClient.send = jest.fn();
});

describe('compareTranscripts (I-08 shared comparator)', () => {
    it('orders USER before AI within the SAME turnIndex regardless of createdAt', () => {
        // createdAt is deliberately inverted (USER later) to prove the ordered
        // sequence — not the timestamp — decides same-turn sub-order.
        const ai = { turnIndex: 1, speaker: 'AI', seq: '000001#1#AI', createdAt: 100, transcriptId: 's#1#AI' };
        const user = { turnIndex: 1, speaker: 'USER', seq: '000001#0#USER', createdAt: 200, transcriptId: 's#1#USER' };
        expect([ai, user].sort(compareTranscripts).map(t => t.speaker)).toEqual(['USER', 'AI']);
        expect([user, ai].sort(compareTranscripts).map(t => t.speaker)).toEqual(['USER', 'AI']);
    });

    it('orders legacy rows (no seq/createdAt, only ISO timestamp) by synthesized sequence, never NaN', () => {
        const legacyOpenerAI = { turnIndex: 0, speaker: 'AI', timestamp: '2026-01-01T00:00:00.000Z', transcriptId: 'a' };
        const legacyUser1 = { turnIndex: 1, speaker: 'USER', timestamp: '2026-01-01T00:00:05.000Z', transcriptId: 'b' };
        const legacyAI1 = { turnIndex: 1, speaker: 'AI', timestamp: '2026-01-01T00:00:06.000Z', transcriptId: 'c' };

        const sorted = [legacyAI1, legacyUser1, legacyOpenerAI].sort(compareTranscripts);
        expect(sorted.map(t => `${t.turnIndex}:${t.speaker}`)).toEqual(['0:AI', '1:USER', '1:AI']);
        // The legacy NaN bug: subtracting ISO strings yielded NaN. Guard it.
        expect(Number.isNaN(compareTranscripts(legacyOpenerAI, legacyUser1))).toBe(false);
        expect(Number.isNaN(compareTranscripts(legacyAI1, legacyUser1))).toBe(false);
    });

    it('interleaves mixed legacy and new rows correctly', () => {
        const newUser0 = { turnIndex: 0, speaker: 'USER', seq: seqFor(0, 'USER'), createdAt: 50, transcriptId: 'n0' };
        const legacyAI0 = { turnIndex: 0, speaker: 'AI', timestamp: '2026-01-01T00:00:09.000Z', transcriptId: 'l0' };
        const sorted = [legacyAI0, newUser0].sort(compareTranscripts);
        expect(sorted.map(t => t.speaker)).toEqual(['USER', 'AI']); // USER(0) before AI(0)
    });

    it('is total and stable: equal seq+createdAt tie-break on transcriptId', () => {
        const x = { seq: 's', createdAt: 5, transcriptId: 'aaa' };
        const y = { seq: 's', createdAt: 5, transcriptId: 'bbb' };
        expect(compareTranscripts(x, y)).toBeLessThan(0);
        expect(compareTranscripts(y, x)).toBeGreaterThan(0);
        expect(compareTranscripts(x, x)).toBe(0);
    });
});

describe('saveTranscript identity and parent fencing',()=>{
  const {DocumentBoundary}=require('../helpers/documentBoundary');
  let db;
  beforeEach(()=>{db=new DocumentBoundary();db.seed('qlue-sessions',{sessionId:'s1',userId:'u',currentState:'LOADING_CONTEXT'});docClient.send.mockImplementation(command=>db.send(command));});
  it('writes stable event identity, sequence and numeric creation time atomically with parent checks',async()=>{
    const t=await saveTranscript('s1',2,'USER','my answer',{eventId:'capture'});
    expect(t.transcriptId).toBe('s1#000002#0#USER#capture');expect(t.seq).toBe('000002#0#USER');expect(typeof t.createdAt).toBe('number');
    const txn=docClient.send.mock.calls.find(([command])=>command.constructor.name==='TransactWriteCommand')[0].input;
    expect(txn.TransactItems[0].ConditionCheck.TableName).toBe('qlue-deletion-jobs');expect(txn.TransactItems[1].ConditionCheck.Key).toEqual({sessionId:'s1'});
  });
  it('same event is idempotent while different event identities preserve both messages',async()=>{
    await saveTranscript('s1',2,'USER','dup',{eventId:'one'});await saveTranscript('s1',2,'USER','dup',{eventId:'one'});await saveTranscript('s1',2,'USER','changed',{eventId:'two'});
    expect((await getTranscriptBySession('s1')).map(x=>x.text)).toEqual(['dup','changed']);
  });
  it('surfaces real write failures without treating a missing parent as a duplicate',async()=>{
    db.beforeSend=command=>{if(command.constructor.name==='TransactWriteCommand')throw new Error('ProvisionedThroughputExceeded');};
    await expect(saveTranscript('s1',2,'USER','x')).rejects.toThrow('ProvisionedThroughputExceeded');
  });
});

describe('getTranscriptBySession (I-08 paginated, chronological)', () => {
    it('paginates across pages and returns chronological order with USER before AI at identical turnIndex', async () => {
        docClient.send
            .mockResolvedValueOnce({
                Items: [
                    { sessionId: 's1', turnIndex: 1, speaker: 'AI', seq: '000001#1#AI', createdAt: 40, transcriptId: 's1#000001#1#AI' },
                    { sessionId: 's1', turnIndex: 1, speaker: 'USER', seq: '000001#0#USER', createdAt: 30, transcriptId: 's1#000001#0#USER' }
                ],
                LastEvaluatedKey: { pk: 'page1' }
            })
            .mockResolvedValueOnce({
                Items: [
                    { sessionId: 's1', turnIndex: 0, speaker: 'AI', seq: '000000#1#AI', createdAt: 10, transcriptId: 's1#000000#1#AI' }
                ]
            });

        const all = await getTranscriptBySession('s1');

        expect(docClient.send).toHaveBeenCalledTimes(2); // did not stop at the first 1MB page
        expect(docClient.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ pk: 'page1' });
        expect(all.map(t => `${t.turnIndex}:${t.speaker}`)).toEqual(['0:AI', '1:USER', '1:AI']);
    });
});
