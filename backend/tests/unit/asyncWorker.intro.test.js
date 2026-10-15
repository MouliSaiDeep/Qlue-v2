const { mockClient: mockAdmissionClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient: AdmissionClient, GetCommand: AdmissionGet } = require('@aws-sdk/lib-dynamodb');
const admissionBoundary = mockAdmissionClient(AdmissionClient);
beforeEach(() => { admissionBoundary.reset(); admissionBoundary.on(AdmissionGet).resolves({}); });
const { handler, generateAtomicTurn } = require('../../src/handlers/interview/asyncWorker');
const { getSessionById, updateSessionState, INTERVIEW_STATES, INTRO_STAGES } = require('../../src/models/session');
const { saveTranscript, getContextWindow } = require('../../src/models/transcript');
const { postToConnection } = require('../../src/lib/websocket');
const { synthesizeSpeech } = require('../../src/lib/polly');
const generateQuestionModule = require('../../src/handlers/interview/generateQuestion');
const processUserInput = require('../../src/handlers/interview/processUserInput');
const terminateSession = require('../../src/handlers/interview/terminateSession');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript', () => ({...jest.requireActual('../../src/models/transcript'), saveTranscript:jest.fn(),getContextWindow:jest.fn(),getLatestTranscripts:jest.fn(),getTranscriptBySession:jest.fn()}));
jest.mock('../../src/lib/websocket');
jest.mock('../../src/lib/polly');
jest.mock('../../src/models/user');
jest.mock('../../src/models/resume');
jest.mock('../../src/handlers/interview/processUserInput');
jest.mock('../../src/handlers/interview/terminateSession');
jest.mock('../../src/handlers/interview/generateQuestion', () => ({
  handler: jest.fn(async () => ({ statusCode: 200, body: JSON.stringify({ question: 'And what happened next in that project?' }) })),
  cleanAIResponse: jest.fn((t) => (t == null ? '' : String(t)))
}));

const conditionalError = () => {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

// I-01: the SELF-INTRO coaching module must advance ONLY on accepted user
// attempts — never on silence re-prompts, retries, or failed generations. The
// stage is persisted ATOMICALLY with the AI_SPEAKING commit, and a complete
// intro needs exactly two accepted attempts (first + revised) before it closes.
// This is the fix for the practice "stopping in the middle and suddenly ending"
// after a couple of pauses (the old flow terminated on turnCount >= 2, which
// silence/retries inflated).
describe('asyncWorker SELF-INTRO stage machine (I-01)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postToConnection.mockResolvedValue(true);
    getContextWindow.mockResolvedValue([]);
    saveTranscript.mockResolvedValue({});
    synthesizeSpeech.mockResolvedValue({ audioBase64: Buffer.from('mp3').toString('base64') });
    updateSessionState.mockResolvedValue({});
    // generateAtomicTurn re-reads the session (BE-BUG #2) before handing control
    // back; keep it non-terminal so the stage/termination logic is exercised.
    getSessionById.mockResolvedValue({ currentState: INTERVIEW_STATES.AI_SPEAKING });
  });

  const introSession = (overrides = {}) => ({
    sessionId: 's1', userId: 'u1', moduleType: 'SELF_INTRO', turnCount: 0, ...overrides
  });
  const aiCommit = () =>
    updateSessionState.mock.calls.find(([, to]) => to === INTERVIEW_STATES.USER_RESPONDING);
  const handBack = () =>
    updateSessionState.mock.calls.find(([, to]) => to === INTERVIEW_STATES.USER_RESPONDING);
  const stageWrites = () =>
    updateSessionState.mock.calls.filter(([, , , u]) => u && u.introStage !== undefined);
  const turnIncrements = () =>
    updateSessionState.mock.calls.filter(([, , , u]) => u && u.incrementTurnCount);

  test('the opener asks for an intro, stamps AWAITING_FIRST_ATTEMPT, and leaves the session answerable', async () => {
    await generateAtomicTurn({
      connectionId: 'c1', sessionId: 's1',
      session: introSession({ turnCount: 0 }), // fresh: no persisted introStage yet
      moduleType: 'SELF_INTRO'
    });

    // The prompt KIND is driven by the stage, not by turnCount.
    expect(generateQuestionModule.handler.mock.calls[0][0].body.introStage).toBe('OPENER');
    // Stage advances to AWAITING_FIRST_ATTEMPT atomically with the commit.
    expect(aiCommit()[3].introStage).toBe(INTRO_STAGES.AWAITING_FIRST_ATTEMPT);
    // Answerable: control returns to the user and the module does NOT end here.
    expect(handBack()).toBeTruthy();
    expect(handBack()[3]).toEqual(expect.objectContaining({ incrementTurnCount: true, transactionItems:expect.any(Array) }));
    expect(terminateSession.handler).not.toHaveBeenCalled();
  });

  test('the FIRST accepted attempt coaches, advances to AWAITING_REVISED_ATTEMPT, and stays answerable', async () => {
    await generateAtomicTurn({
      connectionId: 'c1', sessionId: 's1',
      session: introSession({ turnCount: 1, introStage: INTRO_STAGES.AWAITING_FIRST_ATTEMPT }),
      moduleType: 'SELF_INTRO'
    });

    expect(generateQuestionModule.handler.mock.calls[0][0].body.introStage).toBe('COACHING');
    expect(aiCommit()[3].introStage).toBe(INTRO_STAGES.AWAITING_REVISED_ATTEMPT);
    expect(handBack()).toBeTruthy();            // still answerable
    expect(terminateSession.handler).not.toHaveBeenCalled();
  });

  test('the SECOND accepted attempt closes (no question), marks COMPLETE, and terminates INTRO_COMPLETE', async () => {
    await generateAtomicTurn({
      connectionId: 'c1', sessionId: 's1',
      session: introSession({ turnCount: 2, introStage: INTRO_STAGES.AWAITING_REVISED_ATTEMPT }),
      moduleType: 'SELF_INTRO'
    });

    expect(generateQuestionModule.handler.mock.calls[0][0].body.introStage).toBe('CLOSING');
    expect(aiCommit()[3].introStage).toBe(INTRO_STAGES.COMPLETE);
    // The closing statement is delivered, THEN the session ends gracefully.
    expect(postToConnection).toHaveBeenCalledWith('c1', expect.objectContaining({ type: 'turn_complete' }));
    expect(terminateSession.handler).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('INTRO_COMPLETE')
    }));
    // It ends via the deterministic close, NOT by handing back for a 3rd attempt.
    expect(handBack()[3].expectsAnswer).toBe(false);
  });

  test('two silent re-prompts consume no attempt: no stage advance, no turn increment, never terminates', async () => {
    const leased = introSession({
      turnCount: 1, introStage: INTRO_STAGES.AWAITING_FIRST_ATTEMPT,
      currentState: INTERVIEW_STATES.LOADING_CONTEXT
    });

    for (let i = 0; i < 2; i++) {
      await generateAtomicTurn({
        connectionId: 'c1', sessionId: 's1', session: leased, moduleType: 'SELF_INTRO',
        isReprompt: true,
        preGeneratedText: "I didn't catch that. Could you please repeat?"
      });
    }

    // A re-prompt replays the fixed line (no model call) and, crucially, never
    // writes the stage nor increments the turn count — so no matter how many
    // pauses occur, the two-attempt budget is untouched.
    expect(generateQuestionModule.handler).not.toHaveBeenCalled();
    expect(stageWrites()).toHaveLength(0);
    expect(turnIncrements()).toHaveLength(0);
    expect(terminateSession.handler).not.toHaveBeenCalled();
    // Both re-prompts were actually DELIVERED (I-04: they used to be dropped when
    // processUserInput moved the session to SILENCE_DETECTED and broke the commit).
    const turnCompletes = postToConnection.mock.calls.filter(([, m]) => m.type === 'turn_complete');
    expect(turnCompletes).toHaveLength(2);
  });

  test('a failed generation does NOT advance the stage: it aborts before any introStage is persisted', async () => {
    generateQuestionModule.handler.mockRejectedValueOnce(new Error('bedrock throttled'));

    await expect(generateAtomicTurn({
      connectionId: 'c1', sessionId: 's1',
      session: introSession({ turnCount: 1, introStage: INTRO_STAGES.AWAITING_FIRST_ATTEMPT }),
      moduleType: 'SELF_INTRO'
    })).rejects.toThrow('bedrock throttled');

    // The ONLY writer of introStage is the AI_SPEAKING commit, which is never
    // reached on a generation failure — so the persisted stage cannot move.
    expect(aiCommit()).toBeUndefined();
    expect(stageWrites()).toHaveLength(0);
    expect(saveTranscript).not.toHaveBeenCalled();
    expect(terminateSession.handler).not.toHaveBeenCalled();
  });

  test('a terminate during model+TTS work aborts the commit: stage not advanced, nothing delivered, no revival', async () => {
    // The AI_SPEAKING commit (the sole introStage writer) loses its condition
    // because a concurrent terminate moved the row out of LOADING_CONTEXT.
    updateSessionState.mockRejectedValueOnce(conditionalError());

    const result = await generateAtomicTurn({
      connectionId: 'c1', sessionId: 's1',
      session: introSession({ turnCount: 2, introStage: INTRO_STAGES.AWAITING_REVISED_ATTEMPT }),
      moduleType: 'SELF_INTRO',
      preGeneratedText: 'Great improvement — best of luck out there.'
    });

    expect(result).toEqual({ success: true, aborted: true });
    // introStage is ONLY ever written by the CONDITIONAL AI_SPEAKING commit
    // (LOADING_CONTEXT -> AI_SPEAKING); there is no unconditional stage writer.
    // Since that commit lost its condition, DynamoDB applies no mutation, so the
    // persisted stage stays at AWAITING_REVISED_ATTEMPT — it cannot leak COMPLETE.
    for (const call of stageWrites()) {
      expect(call[1]).toBe(INTERVIEW_STATES.USER_RESPONDING);
      expect(call[2]).toBe(INTERVIEW_STATES.LOADING_CONTEXT);
    }
    expect(saveTranscript).not.toHaveBeenCalled();
    expect(postToConnection).not.toHaveBeenCalledWith('c1', expect.objectContaining({ type: 'turn_complete' }));
    expect(terminateSession.handler).not.toHaveBeenCalled();
    expect(updateSessionState).toHaveBeenCalledTimes(1);
  });

  test('the worker threads a silence re-prompt end-to-end without consuming an attempt (I-04 reconciliation)', async () => {
    getSessionById
      .mockResolvedValueOnce(introSession({
        turnCount: 1, introStage: INTRO_STAGES.AWAITING_FIRST_ATTEMPT,
        currentState: INTERVIEW_STATES.PROCESSING_RESPONSE
      }))
      .mockResolvedValue({ currentState: INTERVIEW_STATES.AI_SPEAKING }); // generateAtomicTurn re-fetch
    processUserInput.handler.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        shouldTerminate: false,
        isReprompt: true,
        silenceRetries: 1,
        nextAIResponse: "I didn't catch that. Could you please repeat?",
        session: introSession({
          turnCount: 1, introStage: INTRO_STAGES.AWAITING_FIRST_ATTEMPT,
          currentState: INTERVIEW_STATES.LOADING_CONTEXT
        })
      })
    });

    await handler({
      Records: [{
        body: JSON.stringify({
          connectionId: 'c1', sessionId: 's1', action: 'turn_submit',
          expectedTurnCount: 1, userId: 'u1',
          body: { isSilence: true, textTranscript: '' }
        })
      }]
    });

    // Delivered...
    expect(postToConnection).toHaveBeenCalledWith('c1', expect.objectContaining({ type: 'turn_complete' }));
    // ...no stage advance, no turn increment...
    expect(stageWrites()).toHaveLength(0);
    expect(turnIncrements()).toHaveLength(0);
    expect(updateSessionState).toHaveBeenCalledWith('s1', INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.LOADING_CONTEXT, expect.objectContaining({transactionItems:[],expectsAnswer:true}));
    // ...reprompt replays the fixed line (no model spend)...
    expect(generateQuestionModule.handler).not.toHaveBeenCalled();
    // ...and the practice does NOT end.
    expect(terminateSession.handler).not.toHaveBeenCalled();
  });
});
