const { createSession, getActiveSessionForUser, INTERVIEW_STATES } = require('../../src/models/session');
const { getUserById } = require('../../src/models/user');
const { handler } = require('../../src/handlers/interview/initializeSession');

jest.mock('../../src/models/session');
jest.mock('../../src/models/user');
jest.mock('../../src/handlers/interview/terminateSession', () => ({
  handler: jest.fn().mockResolvedValue({ statusCode: 200 })
}));

describe('initializeSession handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBSOCKET_ENDPOINT = 'https://api.example.com';
  });

  it('should return 401 if userId is missing', async () => {
    const event = {
      body: JSON.stringify({}),
      requestContext: { authorizer: {} }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it('should create a new session successfully', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME' }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getUserById.mockResolvedValue({ voiceId: 'Ruth' });
    getActiveSessionForUser.mockResolvedValue(null);
    createSession.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessionId).toBeDefined();
    expect(body.wsUrl).toBe('wss://api.example.com');
    expect(createSession).toHaveBeenCalled();
  });

  it('should return 409 if an active session already exists', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME' }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue({ sessionId: 'existing-session', userId: 'user123' });

    const result = await handler(event);

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('ConcurrentSessionError');
  });

  it('should force terminate existing session if force flag is provided', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', force: true }),
      requestContext: { authorizer: { uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue({ sessionId: 'existing-session', userId: 'user123' });
    createSession.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const terminateSession = require('../../src/handlers/interview/terminateSession');
    expect(terminateSession.handler).toHaveBeenCalled();
  });
});
