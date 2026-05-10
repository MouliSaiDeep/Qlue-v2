const { handler } = require('../../src/handlers/auth/registerUser');

// Mock external modules virtually to avoid dependency issues in test environment
jest.mock('axios', () => ({
    post: jest.fn()
}), { virtual: true });

jest.mock('firebase-admin', () => ({
    initializeApp: jest.fn(),
    credential: {
        cert: jest.fn()
    },
    apps: [],
    auth: jest.fn()
}), { virtual: true });

jest.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: jest.fn(),
    GetSecretValueCommand: jest.fn()
}), { virtual: true });

jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn()
    },
    PutCommand: jest.fn(),
    GetCommand: jest.fn(),
    UpdateCommand: jest.fn(),
    DeleteCommand: jest.fn(),
    QueryCommand: jest.fn()
}), { virtual: true });

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn()
}), { virtual: true });

const axios = require('axios');
const firebase = require('../../src/lib/firebase');
const { saveUser } = require('../../src/models/user');

jest.mock('../../src/lib/firebase');
jest.mock('../../src/models/user');

describe('registerUser handler', () => {
    let mockAuth;

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth = {
            createUser: jest.fn().mockResolvedValue({
                uid: 'test-uid',
                email: 'test@example.com',
                displayName: 'Test User'
            })
        };
        firebase.getAuth.mockResolvedValue(mockAuth);
        process.env.FIREBASE_API_KEY = 'test-api-key';
    });

    test('should return 400 if email or password is missing', async () => {
        const event = {
            body: JSON.stringify({ email: 'test@example.com' })
        };

        const response = await handler(event);
        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error).toBe("Email and password are required");
    });

    test('should return 400 if email format is invalid', async () => {
        const event = {
            body: JSON.stringify({
                email: 'invalid-email',
                password: 'Password123!',
                displayName: 'Test User'
            })
        };

        const response = await handler(event);
        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.code).toBe('INVALID_EMAIL');
    });

    test('should return 400 if password is too short', async () => {
        const event = {
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'Pw1!',
                displayName: 'Test User'
            })
        };

        const response = await handler(event);
        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.code).toBe('WEAK_PASSWORD');
    });

    test('should return 400 if password lacks complexity (no uppercase)', async () => {
        const event = {
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'password123!',
                displayName: 'Test User'
            })
        };

        const response = await handler(event);
        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.code).toBe('WEAK_PASSWORD');
    });

    test('should return 400 if displayName is too long', async () => {
        const event = {
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'Password123!',
                displayName: 'A'.repeat(51)
            })
        };

        const response = await handler(event);
        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.code).toBe('INVALID_DISPLAY_NAME');
    });

    test('should return 201 if all inputs are valid', async () => {
        axios.post.mockResolvedValue({ data: { idToken: 'test-token' } });
        saveUser.mockResolvedValue({ success: true });

        const event = {
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'Password123!',
                displayName: 'Test User'
            })
        };

        const response = await handler(event);
        expect(response.statusCode).toBe(201);
        expect(mockAuth.createUser).toHaveBeenCalled();
    });
});
