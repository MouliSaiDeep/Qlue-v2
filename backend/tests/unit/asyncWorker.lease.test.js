const { mockClient: mockAdmissionClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient: AdmissionClient, GetCommand: AdmissionGet } = require('@aws-sdk/lib-dynamodb');
const admissionBoundary = mockAdmissionClient(AdmissionClient);
beforeEach(() => { admissionBoundary.reset(); admissionBoundary.on(AdmissionGet).resolves({}); });
const { handler, generateAtomicTurn } = require('../../src/handlers/interview/asyncWorker');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { saveTranscript, getContextWindow } = require('../../src/models/transcript');
const { postToConnection } = require('../../src/lib/websocket');
const { synthesizeSpeech } = require('../../src/lib/polly');
const processUserInput = require('../../src/handlers/interview/processUserInput');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript', () => ({...jest.requireActual('../../src/models/transcript'), saveTranscript:jest.fn(),getContextWindow:jest.fn(),getLatestTranscripts:jest.fn(),getTranscriptBySession:jest.fn()}));
jest.mock('../../src/lib/websocket');
jest.mock('../../src/lib/polly');
jest.mock('../../src/models/user');
jest.mock('../../src/models/resume');
jest.mock('../../src/handlers/interview/processUserInput');
jest.mock('../../src/handlers/interview/generateQuestion', () => ({
  handler: jest.fn(async () => ({ statusCode: 200, body: JSON.stringify({ question: 'Tell me about a hard problem you solved?' }) })),
  cleanAIResponse: jest.fn((t) => (t == null ? '' : String(t)))
}));

const conditionalError = () => {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

// I-04: a crashed worker holds the turn in LOADING_CONTEXT; its SQS redelivery
// must be able to RECLAIM it once the lease expires, a live lease must never be
// stolen, and no stale worker may commit/transcribe/deliver over a session that
// moved on (terminated, deleted, or already reclaimed) during paid work.
describe('asyncWorker worker lease & crash recovery (I-04)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postToConnection.mockResolvedValue(true);
    getContextWindow.mockResolvedValue([]);
    saveTranscript.mockResolvedValue({});
    synthesizeSpeech.mockResolvedValue({ audioBase64: Buffer.from('mp3').toString('base64') });
    updateSessionState.mockResolvedValue({});
  });

  const turnEvent = (overrides = {}) => ({
    Records: [{
      body: JSON.stringify({
        connectionId: 'c1',
        sessionId: 's1',
        action: 'turn_submit',
        expectedTurnCount: 0,
        userId: 'u1',
        body: { textTranscript: 'my answer', isSilence: false },
        ...overrides
      })
    }]
  });

  test('a live lease is NOT stolen: a duplicate delivery while the turn is still leased does no work', async () => {
    getSessionById.mockResolvedValue({
      sessionId: 's1', userId: 'u1', moduleType: 'HR', turnCount: 0,
      currentState: INTERVIEW_STATES.LOADING_CONTEXT,
      leaseExpiresAt: Date.now() + 60000 // still held by the original worker
    });

    await handler(turnEvent());

    // No claim write, no paid processing, no client traffic.
    expect(updateSessionState).not.toHaveBeenCalled();
    expect(processUserInput.handler).not.toHaveBeenCalled();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(postToConnection).not.toHaveBeenCalled();
  });

  test('an expired lease IS reclaimed: a crashed worker\'s turn is completed exactly once by the redelivery', async () => {
    getSessionById.mockResolvedValue({
      sessionId: 's1', userId: 'u1', moduleType: 'HR', turnCount: 0,
      currentState: INTERVIEW_STATES.LOADING_CONTEXT,
      leaseExpiresAt: Date.now() - 1000 // the previous worker crashed; lease elapsed
    });
    processUserInput.handler.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        shouldTerminate: false,
        session: { sessionId: 's1', userId: 'u1', moduleType: 'HR', turnCount: 0, currentState: INTERVIEW_STATES.LOADING_CONTEXT }
      })
    });

    await handler(turnEvent());

    // Claim RECLAIMS from LOADING_CONTEXT (not PROCESSING_RESPONSE) and re-stamps the lease.
    expect(updateSessionState).toHaveBeenCalledWith(
      's1', INTERVIEW_STATES.LOADING_CONTEXT, INTERVIEW_STATES.LOADING_CONTEXT,
      expect.objectContaining({ expectedTurnCount: 0, leaseExpiresAt: expect.any(Number) })
    );
    // The turn is actually completed: AI_SPEAKING committed, transcript saved, client told once.
    expect(updateSessionState).toHaveBeenCalledWith(
      's1', INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.LOADING_CONTEXT, expect.any(Object)
    );
    expect(updateSessionState.mock.calls.filter(([,to,,u])=>to === INTERVIEW_STATES.USER_RESPONDING && u.transactionItems.length===1)).toHaveLength(1);
    const turnCompletes = postToConnection.mock.calls.filter(([, m]) => m.type === 'turn_complete');
    expect(turnCompletes).toHaveLength(1);
  });

  test('a fresh duplicate delivery loses the atomic claim and does no paid work', async () => {
    getSessionById.mockResolvedValue({
      sessionId: 's1', userId: 'u1', moduleType: 'HR', turnCount: 0,
      currentState: INTERVIEW_STATES.PROCESSING_RESPONSE // no lease yet
    });
    // A sibling worker already claimed: our conditional claim fails.
    updateSessionState.mockRejectedValueOnce(conditionalError());

    await handler(turnEvent());

    expect(processUserInput.handler).not.toHaveBeenCalled();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(postToConnection).not.toHaveBeenCalled();
  });

  test('terminate/delete during model+TTS work: the conditional commit aborts — no transcript, no audio, no revival', async () => {
    // generateAtomicTurn is called with the claimed in-flight session; while it
    // was doing paid work a concurrent terminate moved the session on, so the
    // LOADING_CONTEXT -> AI_SPEAKING commit fails.
    updateSessionState.mockRejectedValueOnce(conditionalError());

    const result = await generateAtomicTurn({
      connectionId: 'c1',
      sessionId: 's1',
      session: { sessionId: 's1', userId: 'u1', moduleType: 'HR', turnCount: 0, currentState: INTERVIEW_STATES.LOADING_CONTEXT },
      moduleType: 'HR',
      preGeneratedText: 'Here is your next question?'
    });

    expect(result).toEqual({ success: true, aborted: true });
    // Nothing may be resurrected: no transcript persisted, no turn delivered.
    expect(saveTranscript).not.toHaveBeenCalled();
    expect(postToConnection).not.toHaveBeenCalledWith('c1', expect.objectContaining({ type: 'turn_complete' }));
    // And the session is never pushed into USER_RESPONDING (which would re-open it).
    expect(updateSessionState).toHaveBeenCalledTimes(1);
  });

  test('a stale worker cannot commit over a job already reclaimed by another worker', async () => {
    // Two workers both believe they hold LOADING_CONTEXT. Whoever commits first
    // (LOADING_CONTEXT -> AI_SPEAKING) wins; a second identical commit then fails
    // the condition because the row is no longer in LOADING_CONTEXT.
    let committed = false;
    updateSessionState.mockImplementation(async (_sid, to, from) => {
      if (to === INTERVIEW_STATES.USER_RESPONDING && from === INTERVIEW_STATES.LOADING_CONTEXT) {
        if (committed) throw conditionalError();
        committed = true;
      }
      return {};
    });

    const base = { sessionId: 's1', userId: 'u1', moduleType: 'HR', turnCount: 0, currentState: INTERVIEW_STATES.LOADING_CONTEXT };
    getSessionById.mockResolvedValue({ ...base, currentState: INTERVIEW_STATES.AI_SPEAKING });

    const a = await generateAtomicTurn({ connectionId: 'c1', sessionId: 's1', session: base, moduleType: 'HR', preGeneratedText: 'Q one?' });
    const b = await generateAtomicTurn({ connectionId: 'c1', sessionId: 's1', session: base, moduleType: 'HR', preGeneratedText: 'Q one?' });

    expect(a.aborted).toBeUndefined(); // A committed
    expect(b).toEqual({ success: true, aborted: true }); // B aborted
    // Exactly one transcript was written across both workers.
    expect(updateSessionState.mock.calls.filter(([,to,,u])=>to===INTERVIEW_STATES.USER_RESPONDING&&u.transactionItems.length===1)).toHaveLength(2);
  });
});
