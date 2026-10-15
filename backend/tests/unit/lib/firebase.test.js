let firebaseLib;
let sdk;

jest.mock('firebase-admin/app', () => ({
    getApps: jest.fn(() => []),
    initializeApp: jest.fn(() => ({})),
    cert: jest.fn(() => ({}))
}));
jest.mock('firebase-admin/auth', () => ({getAuth: jest.fn()}));
jest.mock('firebase-admin/messaging', () => ({getMessaging: jest.fn()}));

jest.mock('fs');
jest.mock('../../../src/lib/secrets', () => ({
    getFirebaseServiceAccount: jest.fn().mockResolvedValue({
        project_id: 'test',
        type: 'service_account',
        private_key_id: 'test',
        private_key: 'test',
        client_email: 'test@test.iam.gserviceaccount.com'
    })
}));

describe('firebase lib', () => {
    let mockAuth;
    let mockMessaging;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();

        firebaseLib = require('../../../src/lib/firebase');
        sdk = firebaseLib.sdk;
        sdk.getApps.mockReturnValue([]);

        mockAuth = {
            verifyIdToken: jest.fn(),
            createCustomToken: jest.fn(),
            deleteUser: jest.fn(),
            getUserByEmail: jest.fn()
        };
        require('firebase-admin/auth').getAuth.mockReturnValue(mockAuth);

        mockMessaging = {
            send: jest.fn()
        };
        require('firebase-admin/messaging').getMessaging.mockReturnValue(mockMessaging);

        require('fs').existsSync.mockReturnValue(false);
    });

    it('getAuth should initialize and return auth instance', async () => {
        const auth = await firebaseLib.getAuth();
        expect(sdk.initializeApp).toHaveBeenCalled();
        expect(auth).toBe(mockAuth);
    });

    it('uses the managed credential even when a local key file exists', async () => {
        require('fs').existsSync.mockReturnValue(true);
        await firebaseLib.getAuth();
        const secrets = require('../../../src/lib/secrets');
        expect(secrets.getFirebaseServiceAccount).toHaveBeenCalledTimes(1);
        expect(sdk.cert).toHaveBeenCalledWith(expect.objectContaining({project_id: 'test'}));
        expect(require('fs').readFileSync).not.toHaveBeenCalled();
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
