const axios = require('axios');
const firebase = require('../../src/lib/firebase');
const { handler } = require('../../src/handlers/auth/loginUser');

jest.mock('axios');
jest.mock('../../src/lib/firebase');

describe('loginUser handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, FIREBASE_API_KEY: 'test-api-key' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return 400 if email or password is missing', async () => {
    const event = {
      body: JSON.stringify({ email: 'test@example.com' })
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Email and password are required');
  });

  it('should return 200 on successful login with verified email', async () => {
    const event = {
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
    };

    axios.post.mockResolvedValue({
      data: {
        idToken: 'test-id-token',
        refreshToken: 'test-refresh-token',
        localId: 'test-uid'
      }
    });

    const mockAuth = {
      getUser: jest.fn().mockResolvedValue({
        uid: 'test-uid',
        emailVerified: true
      })
    };
    firebase.getAuth.mockResolvedValue(mockAuth);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.token).toBe('test-id-token');
    expect(body.uid).toBe('test-uid');
  });

  it('should return 403 if email is not verified', async () => {
    const event = {
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
    };

    axios.post.mockResolvedValue({
      data: {
        idToken: 'test-id-token',
        refreshToken: 'test-refresh-token',
        localId: 'test-uid'
      }
    });

    const mockAuth = {
      getUser: jest.fn().mockResolvedValue({
        uid: 'test-uid',
        emailVerified: false
      })
    };
    firebase.getAuth.mockResolvedValue(mockAuth);

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('should return 401 on invalid credentials', async () => {
    const event = {
      body: JSON.stringify({ email: 'test@example.com', password: 'wrong-password' })
    };

    axios.post.mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'INVALID_PASSWORD'
          }
        }
      }
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Authentication failed');
  });
});
