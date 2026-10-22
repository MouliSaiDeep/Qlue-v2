/**
 * I-08 regression: the accepted answer reaches the prompt EXACTLY ONCE, even
 * when the transcripts GSI has not caught up (eventual consistency).
 *
 * processUserInput threads the just-accepted answer straight into the worker;
 * generateAtomicTurn seeds it into conversationHistory only when the (lagging)
 * context read did not already include it, then re-orders with the shared
 * comparator. This pins the acceptance criterion: "Simulate delayed index
 * visibility and identical turn indexes. The prompt always includes the current
 * answer exactly once, and the report transcript remains chronological."
 *
 * The transcript module is PARTIALLY mocked: getContextWindow is stubbed to
 * simulate GSI lag, but the REAL compareTranscripts/seqFor are kept so the
 * ordering under test is the production ordering.
 */
const { generateAtomicTurn } = require('../../src/handlers/interview/asyncWorker');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { getContextWindow, saveTranscript } = require('../../src/models/transcript');
const { postToConnection } = require('../../src/lib/websocket');
const { synthesizeSpeech } = require('../../src/lib/polly');
const generateQuestionModule = require('../../src/handlers/interview/generateQuestion');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript', () => {
    // Keep the real comparator/seq helpers so ordering is production-accurate;
    // stub only the DynamoDB-backed reads/writes.
    const actual = jest.requireActual('../../src/models/transcript');
    return { ...actual, getContextWindow: jest.fn(), saveTranscript: jest.fn() };
});
jest.mock('../../src/lib/websocket');
jest.mock('../../src/lib/polly');
jest.mock('../../src/models/user');
jest.mock('../../src/models/resume');
jest.mock('../../src/handlers/interview/processUserInput');
jest.mock('../../src/handlers/interview/terminateSession');
jest.mock('../../src/handlers/interview/generateQuestion', () => ({
    handler: jest.fn(async () => ({ statusCode: 200, body: JSON.stringify({ question: 'And what happened next?' }) })),
    cleanAIResponse: jest.fn((t) => (t == null ? '' : String(t)))
}));

const ANSWER = 'I am a backend engineer with five years of experience.';
const promptHistory = () => generateQuestionModule.handler.mock.calls[0][0].body.conversationHistory;

describe('generateAtomicTurn threads the accepted answer exactly once (I-08)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        postToConnection.mockResolvedValue(true);
        saveTranscript.mockResolvedValue({});
        synthesizeSpeech.mockResolvedValue({ audioBase64: Buffer.from('mp3').toString('base64') });
        updateSessionState.mockResolvedValue({});
        // generateAtomicTurn re-reads the session before handing back; keep it
        // non-terminal so the full turn is exercised.
        getSessionById.mockResolvedValue({ currentState: INTERVIEW_STATES.AI_SPEAKING });
    });

    const runTurn = (extra = {}) => generateAtomicTurn({
        connectionId: 'c1', sessionId: 's1',
        session: { sessionId: 's1', userId: 'u1', moduleType: 'HR', turnCount: 1 },
        moduleType: 'HR',
        currentAnswer: ANSWER,
        currentAnswerTurnIndex: 1,
        ...extra
    });

    it('does not repeat a very uncertain recognized name from either live input or stored context', async()=>{
        const text='My name is Rashid. I built an API.';
        const asr={provider:'aws-transcribe',originalTranscript:text,uncertainty:{version:1,spans:[{start:11,end:17}],incomplete:false}};
        getContextWindow.mockResolvedValue([{speaker:'USER',text,turnIndex:0,asr}]);
        await runTurn({currentAnswer:text,currentAsr:asr});
        const history=promptHistory();
        expect(history.filter(h=>h.speaker==='USER')).toHaveLength(2);
        expect(history.every(h=>!h.text.includes('Rashid'))).toBe(true);
        expect(history.filter(h=>h.speaker==='USER').every(h=>h.text.includes('[uncertain audio]'))).toBe(true);
    });

    it('appends the answer when the lagging context window is MISSING it, in chronological position', async () => {
        // GSI lag: only the opener AI@0 is visible; the user's answer@1 is not.
        getContextWindow.mockResolvedValue([
            { speaker: 'AI', text: 'Tell me about yourself.', turnIndex: 0, seq: '000000#1#AI', createdAt: 10 }
        ]);

        await runTurn();

        const history = promptHistory();
        const answers = history.filter(h => h.speaker === 'USER' && h.text === ANSWER);
        expect(answers).toHaveLength(1); // EXACTLY once
        // AI@0 then USER@1 — chronological, USER before the AI turn it will produce.
        expect(history.map(h => `${h.turnIndex}:${h.speaker}`)).toEqual(['0:AI', '1:USER']);
    });

    it('does NOT duplicate the answer when the context window ALREADY includes it (GSI caught up)', async () => {
        getContextWindow.mockResolvedValue([
            { speaker: 'AI', text: 'Tell me about yourself.', turnIndex: 0, seq: '000000#1#AI', createdAt: 10 },
            { speaker: 'USER', text: ANSWER, turnIndex: 1, seq: '000001#0#USER', createdAt: 20 }
        ]);

        await runTurn();

        const history = promptHistory();
        expect(history.filter(h => h.speaker === 'USER' && h.text === ANSWER)).toHaveLength(1);
        expect(history.map(h => `${h.turnIndex}:${h.speaker}`)).toEqual(['0:AI', '1:USER']);
    });

    it('seeds the answer even when the context window is entirely empty under lag', async () => {
        getContextWindow.mockResolvedValue([]); // index has not surfaced anything yet

        await runTurn();

        const history = promptHistory();
        expect(history).toEqual([expect.objectContaining({ speaker: 'USER', text: ANSWER, turnIndex: 1 })]);
    });

    it('adds no synthetic USER row for an opener / empty answer (nothing accepted yet)', async () => {
        getContextWindow.mockResolvedValue([
            { speaker: 'AI', text: 'Tell me about yourself.', turnIndex: 0, seq: '000000#1#AI', createdAt: 10 }
        ]);

        await runTurn({ currentAnswer: '   ', currentAnswerTurnIndex: undefined });

        const history = promptHistory();
        expect(history.some(h => h.speaker === 'USER')).toBe(false);
    });
});
