/**
 * Tests covering the perf/optimizations-and-fixes branch changes.
 */
const { truncateAtSentenceBoundary } = require('../../src/handlers/interview/asyncWorker');
const { analyzeResponseRelevance } = require('../../src/handlers/interview/generateQuestion');

jest.mock('../../src/models/session');
jest.mock('../../src/lib/websocket');
jest.mock('../../src/lib/polly');

describe('truncateAtSentenceBoundary (PERF-FIX #4)', () => {
    it('returns short text untouched', () => {
        expect(truncateAtSentenceBoundary('Hello there.', 300)).toBe('Hello there.');
    });

    it('cuts at the last sentence terminator instead of mid-word', () => {
        const text = 'First sentence is here. Second sentence follows. ' + 'x'.repeat(300);
        const result = truncateAtSentenceBoundary(text, 100);
        expect(result).toBe('First sentence is here. Second sentence follows.');
    });

    it('falls back to a word boundary when no terminator exists', () => {
        const text = 'word '.repeat(100);
        const result = truncateAtSentenceBoundary(text, 52);
        expect(result.length).toBeLessThanOrEqual(53);
        expect(result.endsWith('.')).toBe(true);
        expect(result).not.toMatch(/wor\.$/); // never mid-word
    });
});

describe('analyzeResponseRelevance (PERF-FIX #2)', () => {
    it('no longer flags domain words as irrelevant', () => {
        const answer = 'I built a sports analytics dashboard for a food delivery game studio';
        expect(analyzeResponseRelevance(answer).isRelevant).toBe(true);
    });

    it('accepts short but valid confirmations', () => {
        expect(analyzeResponseRelevance('Yes, exactly right').isRelevant).toBe(true);
    });

    it('still nudges on extremely short answers', () => {
        expect(analyzeResponseRelevance('okay')).toEqual({ isRelevant: false, issue: 'too_short' });
    });

    it('treats empty input as relevant (silence handled elsewhere)', () => {
        expect(analyzeResponseRelevance('').isRelevant).toBe(true);
    });
});

describe('getContextWindow (PERF-FIX #3)', () => {
    let getContextWindow, docClient;

    beforeEach(() => {
        jest.resetModules();
        jest.unmock('../../src/models/session');
        const dynamo = require('../../src/lib/dynamodb');
        docClient = dynamo.docClient;
        docClient.send = jest.fn();
        ({ getContextWindow } = require('../../src/models/transcript'));
    });

    const makeTurns = (from, to) => {
        const items = [];
        for (let i = to; i >= from; i--) {
            items.push({ sessionId: 's1', turnIndex: i, speaker: i % 2 ? 'USER' : 'AI', text: `t${i}` });
        }
        return items; // descending, as the GSI query returns
    };

    it('returns chronological order for short sessions', async () => {
        docClient.send.mockResolvedValueOnce({ Items: makeTurns(0, 3) });
        const window = await getContextWindow('s1', 20);
        expect(window.map(t => t.turnIndex)).toEqual([0, 1, 2, 3]);
        expect(docClient.send).toHaveBeenCalledTimes(1); // no pin query needed
    });

    it('pins the opening turn when the window no longer reaches turn 0', async () => {
        docClient.send
            .mockResolvedValueOnce({ Items: makeTurns(11, 30) }) // recent 20
            .mockResolvedValueOnce({ Items: [{ sessionId: 's1', turnIndex: 0, speaker: 'AI', text: 'opener' }] });

        const window = await getContextWindow('s1', 20);
        expect(window).toHaveLength(20);
        expect(window[0].turnIndex).toBe(0);      // pinned opener
        expect(window[1].turnIndex).toBe(12);     // oldest window item dropped
        expect(window[window.length - 1].turnIndex).toBe(30);
    });

    it('returns empty array for a fresh session', async () => {
        docClient.send.mockResolvedValueOnce({ Items: [] });
        expect(await getContextWindow('s1', 20)).toEqual([]);
    });
});
