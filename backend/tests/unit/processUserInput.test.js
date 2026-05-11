const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { saveTranscript } = require('../../src/models/transcript');
const { handler } = require('../../src/handlers/interview/processUserInput');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript');

describe('processUserInput handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if sessionId is missing', async () => {
    const event = { body: JSON.stringify({}) };
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  it('should handle silence and increment retries', async () => {
    const event = {
      body: JSON.stringify({ sessionId: 'session123', isSilence: true }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getSessionById.mockResolvedValue({ userId: 'user123', silenceRetries: 0 });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.silenceRetries).toBe(1);
    expect(updateSessionState).toHaveBeenCalledWith('session123', INTERVIEW_STATES.SILENCE_DETECTED, null, { silenceRetries: 1 });
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
      body: JSON.stringify({ sessionId: 'session123', textTranscript: 'Goodbye' }),
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
    expect(saveTranscript).toHaveBeenCalledWith('session123', 1, 'USER', 'Hello world');
    expect(updateSessionState).toHaveBeenCalledWith('session123', 'IN_PROGRESS', null, expect.objectContaining({ silenceRetries: 0 }));
  });
});
