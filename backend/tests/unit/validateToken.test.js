const firebase = require('../../src/lib/firebase');
const { handler } = require('../../src/handlers/auth/validateToken');

jest.mock('../../src/lib/firebase');

describe('validateToken authorizer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should allow access with a valid token in authorizationToken', async () => {
        const mockDecodedToken = {
            uid: 'test-user-123',
            email: 'test@example.com',
            email_verified: true
        };

        const mockAuth = {
            verifyIdToken: jest.fn().mockResolvedValue(mockDecodedToken)
        };
        firebase.getAuth.mockResolvedValue(mockAuth);

        const event = {
            authorizationToken: 'Bearer valid-token'
        };

        const result = await handler(event);

        expect(result.principalId).toBe('test-user-123');
        expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
        expect(result.context.uid).toBe('test-user-123');
        expect(result.context.email).toBe('test@example.com');
        expect(result.context.emailVerified).toBe(true);
    });

    it('should allow access with a valid token in headers', async () => {
        const mockDecodedToken = {
            uid: 'test-user-123'
        };

        const mockAuth = {
            verifyIdToken: jest.fn().mockResolvedValue(mockDecodedToken)
        };
        firebase.getAuth.mockResolvedValue(mockAuth);

        const event = {
            headers: {
                Authorization: 'Bearer valid-token'
            }
        };

        const result = await handler(event);

        expect(result.principalId).toBe('test-user-123');
        expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    });

    it('should throw "Unauthorized" if no token is provided', async () => {
        const event = {
            headers: {}
        };

        await expect(handler(event)).rejects.toThrow('Unauthorized');
    });

    it('should throw "Unauthorized" if token is expired', async () => {
        const error = new Error('Token expired');
        error.code = 'auth/id-token-expired';

        const mockAuth = {
            verifyIdToken: jest.fn().mockRejectedValue(error)
        };
        firebase.getAuth.mockResolvedValue(mockAuth);

        const event = {
            authorizationToken: 'Bearer expired-token'
        };

        await expect(handler(event)).rejects.toThrow('Unauthorized');
    });

    it('should deny access if token verification fails for other reasons', async () => {
        const error = new Error('Invalid token');
        error.code = 'auth/invalid-id-token';

        const mockAuth = {
            verifyIdToken: jest.fn().mockRejectedValue(error)
        };
        firebase.getAuth.mockResolvedValue(mockAuth);

        const event = {
            authorizationToken: 'Bearer invalid-token',
            methodArn: 'arn:aws:execute-api:region:account:api/stage/method/resource'
        };

        const result = await handler(event);

        expect(result.principalId).toBe('user');
        expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
        expect(result.policyDocument.Statement[0].Resource).toBe(event.methodArn);
    });
});
