const firebase = require('../../lib/firebase');

/**
 * AWS Lambda Handler: POST /auth/logout
 */
exports.handler = async (event) => {
    try {
        // userId sourced from the Lambda Authorizer context (validateToken.js)
        const uid = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;

        if (!uid) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'User context missing' })
            };
        }

        // Revoke all Firebase refresh tokens associated with this user
        const auth = await firebase.getAuth();
        await auth.revokeRefreshTokens(uid);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Logout successful' })
        };
    } catch (error) {
        console.error('Logout Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'LOGOUT_FAILED', details: error.message })
        };
    }
};
