const { handler } = require('../../src/handlers/auth/getUserProfile');
const { getUserById } = require('../../src/models/user');

/**
 * Note: The task description provided a code snippet that uses '../../lib/dynamodb'.
 * However, the actual file backend/src/handlers/auth/getUserProfile.js uses
 * '../../src/models/user' and handles multiple userId sources.
 * These tests are written against the ACTUAL implementation found in the repository.
 */

// Mock the user model
jest.mock('../../src/models/user', () => ({
    getUserById: jest.fn()
}));

describe('getUserProfile handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should return 200 and user profile when user is found (using uid)', async () => {
        const mockUser = {
            userId: 'user-123',
            email: 'test@example.com',
            displayName: 'Test User',
            photoUrl: 'http://example.com/photo.jpg',
            profession: 'Engineer',
            skills: ['JavaScript', 'AWS'],
            voiceId: 'Tiffany',
            activeResumeId: 'resume-456',
            createdAt: '2023-01-01T00:00:00Z'
        };

        getUserById.mockResolvedValue(mockUser);

        const event = {
            requestContext: {
                authorizer: {
                    uid: 'user-123'
                }
            }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).toEqual(mockUser);
        expect(getUserById).toHaveBeenCalledWith('user-123');
    });

    test('should return 200 and user profile when user is found (using principalId)', async () => {
        const mockUser = {
            userId: 'user-123',
            email: 'test@example.com'
        };

        getUserById.mockResolvedValue(mockUser);

        const event = {
            requestContext: {
                authorizer: {
                    principalId: 'user-123'
                }
            }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        expect(getUserById).toHaveBeenCalledWith('user-123');
    });

    test('should return 200 and user profile when user is found (using claims.sub)', async () => {
        const mockUser = {
            userId: 'user-123',
            email: 'test@example.com'
        };

        getUserById.mockResolvedValue(mockUser);

        const event = {
            requestContext: {
                authorizer: {
                    claims: {
                        sub: 'user-123'
                    }
                }
            }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        expect(getUserById).toHaveBeenCalledWith('user-123');
    });

    test('should handle default values for user profile fields', async () => {
        const mockUser = {
            userId: 'user-123',
            email: 'test@example.com',
            createdAt: '2023-01-01T00:00:00Z'
            // other fields missing
        };

        getUserById.mockResolvedValue(mockUser);

        const event = {
            requestContext: {
                authorizer: {
                    uid: 'user-123'
                }
            }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.displayName).toBe('');
        expect(body.photoUrl).toBe('');
        expect(body.profession).toBe('');
        expect(body.skills).toEqual([]);
        expect(body.voiceId).toBe('Tiffany');
        expect(body.activeResumeId).toBeNull();
    });

    test('should return 401 when userId is missing in authorizer', async () => {
        const event = {
            requestContext: {
                authorizer: {}
            }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('UNAUTHORIZED');
        expect(body.message).toBe('User context missing');
    });

    test('should return 401 when requestContext is missing', async () => {
        const event = {};

        const response = await handler(event);

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body).error).toBe('UNAUTHORIZED');
    });

    test('should return 404 when user is not found in database', async () => {
        getUserById.mockResolvedValue(null);

        const event = {
            requestContext: {
                authorizer: {
                    uid: 'user-123'
                }
            }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(404);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('USER_NOT_FOUND');
        expect(body.message).toBe('User record not found');
    });

    test('should return 500 when getUserById throws an error', async () => {
        getUserById.mockRejectedValue(new Error('Database error'));

        const event = {
            requestContext: {
                authorizer: {
                    uid: 'user-123'
                }
            }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body);
        expect(body.error).toBe('GET_PROFILE_FAILED');
        expect(body.details).toBe('Database error');
    });
});
