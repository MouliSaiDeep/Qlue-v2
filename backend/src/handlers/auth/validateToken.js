const admin = require('../../lib/firebase');

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
        const decodedToken = await admin.auth().verifyIdToken(bearerToken, true);
        
        // Return IAM Policy for Authorized user
        return generatePolicy(decodedToken.uid, 'Allow', event.methodArn || '*', {
            uid: decodedToken.uid,
            email: decodedToken.email || '',
            emailVerified: decodedToken.email_verified || false
        });

    } catch (error) {
        console.error("Token verification failed:", error.message);
        
        // Return Deny policy instead of throwing to avoid 500s where 403 is intended
        // Note: For 401, we must throw "Unauthorized"
        if (error.code === 'auth/id-token-expired') {
            throw new Error("Unauthorized");
        }

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
