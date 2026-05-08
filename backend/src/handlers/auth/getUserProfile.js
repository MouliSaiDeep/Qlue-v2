const { getUserById } = require('../../models/user');

/**
 * AWS Lambda Handler: GET /auth/profile
 */
exports.handler = async (event) => {
    try {
        // userId sourced from the Lambda Authorizer context (validateToken.js)
        const authorizer = event.requestContext?.authorizer;
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;


        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'User context missing' })
            };
        }

        const user = await getUserById(userId);

        if (!user) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'USER_NOT_FOUND', message: 'User record not found' })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                userId: user.userId,
                email: user.email,
                displayName: user.displayName || '',
                photoUrl: user.photoUrl || '',
                profession: user.profession || '',
                skills: user.skills || [],
                voiceId: user.voiceId || 'Tiffany',
                activeResumeId: user.activeResumeId || null,
                createdAt: user.createdAt
            })
        };

    } catch (error) {
        console.error('Get Profile Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'GET_PROFILE_FAILED', details: error.message })
        };
    }
};
