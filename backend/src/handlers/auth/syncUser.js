const admin = require('../../lib/firebase');
const { saveUser, getUserById } = require('../../models/user');

/**
 * AWS Lambda Handler: POST /auth/sync
 * Ensures the user exists in the backend database after Firebase authentication.
 */
exports.handler = async (event) => {
    try {
        const uid = event.requestContext?.authorizer?.uid;
        
        if (!uid) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'User UID missing' })
            };
        }

        // Fetch user from Firebase to get latest metadata
        const firebaseUser = await admin.auth().getUser(uid);
        
        let user = await getUserById(uid);
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            user = {
                userId: uid,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName || 'User',
                photoUrl: firebaseUser.photoURL || '',
                authProvider: firebaseUser.providerData[0]?.providerId || 'FIREBASE',
                createdAt: new Date().toISOString()
            };
            await saveUser(user);
        } else {
            // Update existing user if necessary (e.g. name changed in Firebase)
            const updates = {};
            if (firebaseUser.displayName && firebaseUser.displayName !== user.displayName) {
                updates.displayName = firebaseUser.displayName;
            }
            if (firebaseUser.photoURL && firebaseUser.photoURL !== user.photoUrl) {
                updates.photoUrl = firebaseUser.photoURL;
            }
            
            if (Object.keys(updates).length > 0) {
                user = { ...user, ...updates };
                await saveUser(user);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "User sync successful",
                user,
                isNewUser
            })
        };
    } catch (error) {
        console.error('Auth Sync Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'AUTH_SYNC_FAILED', details: error.message })
        };
    }
};
