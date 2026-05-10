const firebase = require('../../lib/firebase');

/**
 * AWS Lambda Authorizer: Validates Firebase ID Tokens for API Gateway
 */
exports.handler = async (event) => {
    const token = event.authorizationToken || event.headers?.Authorization || event.headers?.authorization;

    if (!token) {
        console.error("No token provided");
        throw new Error("Unauthorized"); // API Gateway expects "Unauthorized" literal for 401
    }

    const bearerToken = token.startsWith('Bearer ') ? token.split(' ')[1] : token;

    try {
        const auth = await firebase.getAuth();
        
        // The 'true' flag forces a backend revocation check. 
        // This is highly secure but susceptible to slight network delays/clock skew.
        const decodedToken = await auth.verifyIdToken(bearerToken, true);
        
        // Return IAM Policy for Authorized user
        // Using '*' for resource to allow the cached policy to work for all endpoints
        return generatePolicy(decodedToken.uid, 'Allow', '*', {
            uid: decodedToken.uid,
            email: decodedToken.email || '',
            emailVerified: decodedToken.email_verified || false
        });

    } catch (error) {
        console.error("Token verification failed:", error.code, error.message);
        
        // FIX: Treat ANY standard Firebase Auth token error as a 401 Unauthorized.
        // This includes 'auth/id-token-expired', 'auth/invalid-id-token' (clock skew), 
        // and 'auth/id-token-revoked'.
        if (error.code && error.code.startsWith('auth/')) {
            throw new Error("Unauthorized");
        }

        // Return Deny policy (403) ONLY as a fallback for severe structural or internal errors
        return generatePolicy('user', 'Deny', event.methodArn || '*');
    }
};

/**
 * Helper to generate IAM Policy for API Gateway Authorizers
 */
function generatePolicy(principalId, effect, resource, context = {}) {
    const authResponse = {
        principalId: principalId
    };

    if (effect && resource) {
        const policyDocument = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: 'execute-api:Invoke',
                    Effect: effect,
                    Resource: resource
                }
            ]
        };
        authResponse.policyDocument = policyDocument;
    }

    if (context) {
        authResponse.context = context;
    }

    return authResponse;
}