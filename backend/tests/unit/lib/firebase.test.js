const firebaseLib = require('../../../src/lib/firebase');
const sdk = require('firebase-admin');
const fs = require('fs');

jest.mock('firebase-admin', () => ({
    apps: [],
    initializeApp: jest.fn(),
    credential: {
        cert: jest.fn()
    },
    auth: jest.fn(),
    messaging: jest.fn()
}));

jest.mock('fs');
jest.mock('../../../src/lib/secrets', () => ({
    getFirebaseServiceAccount: jest.fn().mockResolvedValue('{"project_id": "test"}')
}));

describe('firebase lib', () => {
    let mockAuth;
    let mockMessaging;

    beforeEach(() => {
        jest.clearAllMocks();
        sdk.apps = [];
        
        mockAuth = {
            verifyIdToken: jest.fn(),
            createCustomToken: jest.fn(),
            deleteUser: jest.fn(),
            getUserByEmail: jest.fn()
        };
        sdk.auth.mockReturnValue(mockAuth);

        mockMessaging = {
            send: jest.fn()
        };
        sdk.messaging.mockReturnValue(mockMessaging);

        fs.existsSync.mockReturnValue(false);
    });

    it('getAuth should initialize and return auth instance', async () => {
        const auth = await firebaseLib.getAuth();
        expect(sdk.initializeApp).toHaveBeenCalled();
        expect(auth).toBe(mockAuth);
    });

    it('verifyIdToken should return decoded token', async () => {
        mockAuth.verifyIdToken.mockResolvedValue({ uid: '123' });
        const result = await firebaseLib.verifyIdToken('token');
        expect(result.uid).toBe('123');
    });

    it('verifyIdToken should throw QlueError on expiry', async () => {
        const error = new Error('Expired');
        error.code = 'auth/id-token-expired';
        mockAuth.verifyIdToken.mockRejectedValue(error);
        
        await expect(firebaseLib.verifyIdToken('token')).rejects.toThrow('Token expired');
    });

    it('deleteUser should return true if successful', async () => {
        mockAuth.deleteUser.mockResolvedValue();
        const result = await firebaseLib.deleteUser('123');
        expect(result).toBe(true);
    });

    it('deleteUser should return false if user not found', async () => {
        const error = new Error('Not found');
        error.code = 'auth/user-not-found';
        mockAuth.deleteUser.mockRejectedValue(error);
        
        const result = await firebaseLib.deleteUser('123');
        expect(result).toBe(false);
    });

    it('sendNotification should return success', async () => {
        mockMessaging.send.mockResolvedValue('msg-id');
        const result = await firebaseLib.sendNotification('token', { title: 'hi' });
        expect(result.success).toBe(true);
        expect(result.messageId).toBe('msg-id');
    });
});
