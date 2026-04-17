const admin = require('../../lib/firebase');
const { saveUser, getUserById } = require('../../models/user');

/**
 * AWS Lambda Handler: POST /auth/google
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { idToken } = body;

        if (!idToken) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'INVALID_ID_TOKEN', message: 'Missing idToken' })
            };
        }

        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        } catch (err) {
            console.error('Firebase token verification failed:', err.message);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'INVALID_ID_TOKEN' })
            };
        }

        const firebaseUid = decodedToken.uid;
        const email = (decodedToken.email || '').toLowerCase();
        const displayName = decodedToken.name || 'User';
        const photoUrl = decodedToken.picture || '';

        let user = await getUserById(firebaseUid);
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            user = {
                userId: firebaseUid,
                email,
                displayName: displayName.substring(0, 50),
                photoUrl,
                authProvider: 'GOOGLE_OAUTH',
                createdAt: new Date().toISOString()
            };
            await saveUser(user);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Google login successful",
                userId: user.userId,
                email: user.email,
                displayName: user.displayName,
                photoUrl: user.photoUrl,
                isNewUser
            })
        };
    } catch (error) {
        console.error('Google Auth Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'GOOGLE_AUTH_FAILED', details: error.message })
        };
    }
};
