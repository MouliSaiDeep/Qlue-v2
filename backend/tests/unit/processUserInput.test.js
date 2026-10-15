const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { saveTranscript } = require('../../src/models/transcript');
const { handler } = require('../../src/handlers/interview/processUserInput');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript');

describe('processUserInput handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['INTRO', 'SELF_INTRO'])('re-prompts a fragment without consuming the revised %s attempt', async (moduleType) => {
    const session = { userId: 'u', moduleType, turnCount: 2, introStage: 'REVISED', answeredCount: 1,
      currentState: INTERVIEW_STATES.LOADING_CONTEXT };
    getSessionById.mockResolvedValue(session);
    updateSessionState.mockResolvedValue(session);
    const result = await handler({ body: JSON.stringify({ sessionId: 's', textTranscript: 'fast',
      clientTurnId: 'answer-id', lease: { expectedJobId: 'job-id' } }), requestContext: { authorizer: { uid: 'u' } } });
    const body = JSON.parse(result.body);
    expect(body.isReprompt).toBe(true);
    expect(body.shouldTerminate).toBe(false);
    expect(body.session.introStage).toBe('REVISED');
    expect(updateSessionState).toHaveBeenCalledWith('s', session.currentState, session.currentState,
      { expectedJobId: 'job-id', fragmentRetries: 1, fragmentIds: ['answer-id'] });
    expect(saveTranscript).toHaveBeenCalledWith('s', 2, 'USER', 'fast',
      { eventId: 'answer-id', expectedJobId: 'job-id' });
  });

  it('does not revive a concurrently closed session during a fragment re-prompt', async () => {
    getSessionById.mockResolvedValue({ userId: 'u', moduleType: 'INTRO', currentState: INTERVIEW_STATES.LOADING_CONTEXT });
    updateSessionState.mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'ConditionalCheckFailedException' }));
    const result = await handler({ body: JSON.stringify({ sessionId: 's', textTranscript: 'fast' }),
      requestContext: { authorizer: { uid: 'u' } } });
    expect(JSON.parse(result.body)).toEqual({ aborted: true });
  });

  it('should return 400 if sessionId is missing', async () => {
    const event = { body: JSON.stringify({}) };
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('handles silence as a non-progressing re-prompt without leaving the claimed state', async () => {
    const event = {
      body: JSON.stringify({ sessionId: 'session123', isSilence: true }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    // The worker has already claimed the turn into LOADING_CONTEXT.
    getSessionById.mockResolvedValue({ userId: 'user123', silenceRetries: 0, currentState: INTERVIEW_STATES.LOADING_CONTEXT });
    updateSessionState.mockResolvedValue({ currentState: INTERVIEW_STATES.LOADING_CONTEXT, silenceRetries: 1 });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.silenceRetries).toBe(1);
    expect(body.isReprompt).toBe(true);
    expect(body.shouldTerminate).toBe(false);
    // I-04 regression: silence must NOT move the session to SILENCE_DETECTED
    // (which would fail generateAtomicTurn's LOADING_CONTEXT -> AI_SPEAKING
    // conditional commit and silently drop the re-prompt). It persists the retry
    // counter CONDITIONAL on the claimed state so a concurrent terminate can't be
    // revived.
    expect(updateSessionState).toHaveBeenCalledWith(
      'session123',
      INTERVIEW_STATES.LOADING_CONTEXT,
      INTERVIEW_STATES.LOADING_CONTEXT,
      { silenceRetries: 1 }
    );
    expect(updateSessionState).not.toHaveBeenCalledWith(
      'session123', INTERVIEW_STATES.SILENCE_DETECTED, expect.anything(), expect.anything()
    );
  });

  it('aborts (no revival) when the claimed state was advanced during a silence re-prompt', async () => {
    const event = {
      body: JSON.stringify({ sessionId: 'session123', isSilence: true }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getSessionById.mockResolvedValue({ userId: 'user123', silenceRetries: 0, currentState: INTERVIEW_STATES.LOADING_CONTEXT });
    const condErr = new Error('The conditional request failed');
    condErr.name = 'ConditionalCheckFailedException';
    updateSessionState.mockRejectedValueOnce(condErr);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.aborted).toBe(true);
    expect(body.nextAIResponse).toBeUndefined();
  });

  it('should terminate if silence threshold is reached', async () => {
    const event = {
      body: JSON.stringify({ sessionId: 'session123', isSilence: true }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getSessionById.mockResolvedValue({ userId: 'user123', silenceRetries: 4 });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.shouldTerminate).toBe(true);
    expect(body.reason).toBe('SILENCE_TIMEOUT');
  });

  it('should detect exit intent', async () => {
    const event = {
      body: JSON.stringify({ sessionId: 'session123', textTranscript: 'End the interview' }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getSessionById.mockResolvedValue({ userId: 'user123', turnCount: 1 });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.shouldTerminate).toBe(true);
    expect(body.reason).toBe('USER_EXIT');
  });

  it('should save user transcript and reset silence retries on valid input', async () => {
    const event = {
      body: JSON.stringify({ sessionId: 'session123', textTranscript: 'Hello world' }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getSessionById.mockResolvedValue({ userId: 'user123', turnCount: 1, currentState: 'IN_PROGRESS' });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(saveTranscript).toHaveBeenCalledWith('session123', 1, 'USER', 'Hello world', {eventId:'legacy-1-64ec88ca00b268e5ba1a3567'});
    // I-04: the preserve-state write is CONDITIONAL on the claimed state
    // (expectedCurrentState === currentState), not an unconditional `null`, so a
    // concurrent terminate that advanced the row aborts instead of being revived.
    expect(updateSessionState).toHaveBeenCalledWith('session123', 'IN_PROGRESS', 'IN_PROGRESS', expect.objectContaining({ silenceRetries: 0 }));
  });

  it('aborts the normal path (no revival) when a concurrent terminate advanced the claimed state', async () => {
    const event = {
      body: JSON.stringify({ sessionId: 'session123', textTranscript: 'Hello world' }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getSessionById.mockResolvedValue({ userId: 'user123', turnCount: 1, currentState: 'IN_PROGRESS' });
    const condErr = new Error('The conditional request failed');
    condErr.name = 'ConditionalCheckFailedException';
    updateSessionState.mockRejectedValueOnce(condErr);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.aborted).toBe(true);
    // The USER transcript is still saved (ordering is addressed under I-08), but
    // no non-aborted turn result is returned for the worker to generate against.
    expect(body.shouldTerminate).toBeUndefined();
  });
});
