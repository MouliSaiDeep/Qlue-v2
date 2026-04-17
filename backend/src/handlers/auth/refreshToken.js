const axios = require('axios');

/**
 * AWS Lambda Handler: POST /auth/refresh
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { refreshToken: incomingToken } = body;

        if (!incomingToken) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'MISSING_REFRESH_TOKEN' })
            };
        }

        const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
        if (!FIREBASE_API_KEY) {
            throw new Error("Internal Configuration Error: Missing Firebase API Key");
        }

        // Call Firebase Secure Token API to refresh the Firebase token
        const response = await axios.post(
            `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
            {
                grant_type: 'refresh_token',
                refresh_token: incomingToken,
            }
        );

        return {
            statusCode: 200,
            body: JSON.stringify({
                token: response.data.id_token,
                refreshToken: response.data.refresh_token,
                expiresIn: response.data.expires_in,
            })
        };
    } catch (error) {
        console.error('Refresh Token Error:', error.response?.data || error.message);
        
        if (error.response?.data?.error?.message === 'TOKEN_EXPIRED') {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'REFRESH_TOKEN_EXPIRED' })
            };
        }

        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'INVALID_REFRESH_TOKEN' })
        };
    }
};
