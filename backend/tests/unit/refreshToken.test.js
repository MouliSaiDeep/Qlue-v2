const axios = require('axios');
const { handler } = require('../../src/handlers/auth/refreshToken');

jest.mock('axios');

describe('refreshToken handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, FIREBASE_API_KEY: 'test-api-key' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return 400 if refreshToken is missing', async () => {
    const event = {
      body: JSON.stringify({})
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('MISSING_REFRESH_TOKEN');
  });

  it('should return 200 on successful token refresh', async () => {
    const event = {
      body: JSON.stringify({ refreshToken: 'test-refresh-token' })
    };

    axios.post.mockResolvedValue({
      data: {
        id_token: 'new-id-token',
        refresh_token: 'new-refresh-token',
        expires_in: '3600'
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.token).toBe('new-id-token');
    expect(body.refreshToken).toBe('new-refresh-token');
  });

  it('should return 401 if refresh token is expired', async () => {
    const event = {
      body: JSON.stringify({ refreshToken: 'expired-token' })
    };

    axios.post.mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'TOKEN_EXPIRED'
          }
        }
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('REFRESH_TOKEN_EXPIRED');
  });

  it('should return 401 on invalid refresh token', async () => {
    const event = {
      body: JSON.stringify({ refreshToken: 'invalid-token' })
    };

    axios.post.mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'INVALID_REFRESH_TOKEN'
          }
        }
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('INVALID_REFRESH_TOKEN');
  });
});
