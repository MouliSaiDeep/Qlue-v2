const firebase = require('../../lib/firebase');
const otp = require('../../lib/emailOtp');

/**
 * AWS Lambda Handler: POST /auth/register
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { password, displayName } = body;
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

        if (!email || !password) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Email and password are required" })
            };
        }

        if (typeof password !== 'string' || (displayName !== undefined && typeof displayName !== 'string')) return {statusCode:400,body:JSON.stringify({error:'Invalid registration input'})};

        // 1. Enhanced Input Validation

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Invalid email format",
                    code: "INVALID_EMAIL"
                })
            };
        }

        // Password complexity validation:
        // - At least 8 characters
        // - At least one uppercase letter
        // - At least one lowercase letter
        // - At least one number
        // - At least one special character (any non-alphanumeric)
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
        const isLongEnough = password.length >= 8;

        if (!isLongEnough || !hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one special character.",
                    code: "WEAK_PASSWORD"
                })
            };
        }

        // Display name length validation
        if (displayName && displayName.length > 50) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: "Display name must be at most 50 characters long",
                    code: "INVALID_DISPLAY_NAME"
                })
            };
        }

        // Fail closed before creating an account if OTP delivery is not configured.
        await otp.configured();

        // 2. Create the user in Firebase Auth
        const auth = await firebase.getAuth();
        const userRecord = await auth.createUser({
            email,
            password,
            displayName: displayName || undefined,
            emailVerified: false 
        });

        // 3. Sync to DynamoDB (Non-blocking fallback)
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

        return { statusCode: 201, headers: {'Content-Type':'application/json','Cache-Control':'no-store'}, body: JSON.stringify({
            message: 'Account created. Sign in to verify your email with a code.',
            userId: userRecord.uid, verificationRequired: true
        }) };

    } catch (error) {
        require('../../lib/logger').safeConsole.warn('Registration failed', {code:error.code,name:error.name});
        if (error.statusCode === 503) return {statusCode:503,body:JSON.stringify({error:error.message,code:error.code})};
        if (error instanceof SyntaxError) return {statusCode:400,body:JSON.stringify({error:'Invalid request body'})};

        if (error.code === 'auth/email-already-exists') {
            return {
                statusCode: 409,
                body: JSON.stringify({ error: "A user with this email already exists" })
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: "Internal server error during registration"
            })
        };
    }
};
