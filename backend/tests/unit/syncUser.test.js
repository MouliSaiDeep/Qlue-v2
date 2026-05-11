const firebase = require('../../src/lib/firebase');
const { saveUser, getUserById } = require('../../src/models/user');
const { handler } = require('../../src/handlers/auth/syncUser');

jest.mock('../../src/lib/firebase');
jest.mock('../../src/models/user');

describe('syncUser handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if UID is missing in authorizer', async () => {
    const event = {
      requestContext: {
        authorizer: {}
      }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('UNAUTHORIZED');
  });

  it('should sync a new user successfully', async () => {
    const event = {
      requestContext: {
        authorizer: { uid: 'test-uid' }
      }
    };

    const mockFirebaseUser = {
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: 'http://photo.url',
      providerData: [{ providerId: 'google.com' }]
    };

    firebase.getAuth.mockResolvedValue({
      getUser: jest.fn().mockResolvedValue(mockFirebaseUser)
    });

    getUserById.mockResolvedValue(null);
    saveUser.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.isNewUser).toBe(true);
    expect(body.user.email).toBe('test@example.com');
    expect(saveUser).toHaveBeenCalled();
  });

  it('should sync an existing user and update if needed', async () => {
    const event = {
      requestContext: {
        authorizer: { uid: 'test-uid' }
      }
    };

    const mockFirebaseUser = {
      email: 'test@example.com',
      displayName: 'New Name',
      photoURL: 'http://new.photo.url',
      providerData: [{ providerId: 'google.com' }]
    };

    const existingUser = {
      userId: 'test-uid',
      email: 'test@example.com',
      displayName: 'Old Name',
      photoUrl: 'http://old.photo.url'
    };

    firebase.getAuth.mockResolvedValue({
      getUser: jest.fn().mockResolvedValue(mockFirebaseUser)
    });

    getUserById.mockResolvedValue(existingUser);
    saveUser.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.isNewUser).toBe(false);
    expect(body.user.displayName).toBe('New Name');
    expect(saveUser).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'New Name',
      photoUrl: 'http://new.photo.url'
    }));
  });

  it('should return 500 on error', async () => {
    const event = {
      requestContext: {
        authorizer: { uid: 'test-uid' }
      }
    };

    firebase.getAuth.mockRejectedValue(new Error('Firebase error'));

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toBe('AUTH_SYNC_FAILED');
  });
});
