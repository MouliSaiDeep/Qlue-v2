const axios = require('axios');
const admin = require('../../lib/firebase');

/**
 * AWS Lambda Handler: POST /auth/login
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { email, password } = body;

        if (!email || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Email and password are required" })
            };
        }

        const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
        if (!FIREBASE_API_KEY) {
            throw new Error("Internal Configuration Error: Missing Firebase API Key");
        }

        // 1. Authenticate using the Firebase Identity Toolkit (Auth REST API)
        const response = await axios.post(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
            {
                email,
                password,
                returnSecureToken: true,
            }
        );

        const { idToken, refreshToken, localId } = response.data;

        // 2. Retrieve the user from Firebase Admin to check email verification
        const userRecord = await admin.auth().getUser(localId);

        if (!userRecord.emailVerified) {
            return {
                statusCode: 403,
                body: JSON.stringify({
                    error: "EMAIL_NOT_VERIFIED",
                    message: "Please click the verification link sent to your email to activate your account before logging in."
                })
            };
        }

        // 3. Login successful
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Login successful",
                uid: localId,
                token: idToken,
                refreshToken: refreshToken
            })
        };

    } catch (error) {
        console.error("Login error:", error.response?.data || error.message);
        const errorMessage = error.response?.data?.error?.message || "Invalid credentials";
        
        return {
            statusCode: 401,
            body: JSON.stringify({ 
                error: "Authentication failed", 
                details: errorMessage 
            })
        };
    }
};
