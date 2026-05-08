const firebase = require('../../lib/firebase');
const axios = require('axios');

/**
 * AWS Lambda Handler: POST /auth/register
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        console.debug("Registration Request:", { ...body, password: '***' });
        const { email, password, displayName } = body;

        if (!email || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Email and password are required" })
            };
        }

        if (password.length < 6) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Password must be at least 6 characters long" })
            };
        }

        // 1. Create the user in Firebase Auth
        const auth = await firebase.getAuth();
        const userRecord = await auth.createUser({
            email,
            password,
            displayName: displayName || undefined,
            emailVerified: false 
        });

        // 2. Sync to DynamoDB (Non-blocking fallback)
        try {
            const { saveUser } = require('../../models/user');
            await saveUser({
                userId: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName,
                createdAt: new Date().toISOString()
            });
        } catch (dbErr) {
            console.warn("DynamoDB Sync Failed but Firebase user exists:", dbErr.message);
            // We continue because the user is successfully created in Firebase
        }

        const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
        if (!FIREBASE_API_KEY) {
            console.warn("FIREBASE_API_KEY not found in env. Email verification skipped.");
            return {
                statusCode: 201,
                body: JSON.stringify({
                    message: "User registered successfully, but verification email could not be sent (missing API config)",
                    userId: userRecord.uid
                })
            };
        }

        try {
            // 2. We use the Web REST API to securely login the user behind the scenes 
            // to get their idToken, which is required to trigger Firebase's native verification email
            const signInRes = await axios.post(
                `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
                { email, password, returnSecureToken: true }
            );
            
            const idToken = signInRes.data.idToken;

            // 3. Trigger Firebase's native email sender
            await axios.post(
                `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
                { requestType: 'VERIFY_EMAIL', idToken: idToken }
            );
        } catch (emailErr) {
            console.error("Email verification trigger failed:", emailErr.response?.data || emailErr.message);
            // We still return 201 because the user account WAS created
            return {
                statusCode: 201,
                body: JSON.stringify({
                    message: "User registered, but verification email failed to send.",
                    userId: userRecord.uid,
                    verificationError: true
                })
            };
        }

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "User registered successfully! A verification link has been sent to your email address.",
                userId: userRecord.uid,
                verificationSent: true
            })
        };

    } catch (error) {
        console.error("Firebase Registration Error:", error.message);

        if (error.code === 'auth/email-already-exists') {
            return {
                statusCode: 409,
                body: JSON.stringify({ error: "A user with this email already exists" })
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: "Internal server error during registration",
                details: error.message
            })
        };
    }
};
