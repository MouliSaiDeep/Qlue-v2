const { update } = require('../../lib/dynamodb');

const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

/**
 * AWS Lambda Handler: POST /auth/fcm-token
 * Updates the user's FCM registration token for push notifications.
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'User context missing' })
            };
        }

        const body = JSON.parse(event.body || '{}');
        const { fcmToken } = body;

        if (!fcmToken) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'INVALID_INPUT', message: 'fcmToken is required' })
            };
        }

        console.log(`Updating FCM token for user ${userId}`);

        const updateExpression = 'SET fcmToken = :fcmToken, updatedAt = :updatedAt';
        const expressionAttributeValues = {
            ':fcmToken': fcmToken,
            ':updatedAt': new Date().toISOString()
        };

        const result = await update(
            USERS_TABLE,
            { userId },
            updateExpression,
            expressionAttributeValues
        );

        if (!result.success) {
            console.error('DynamoDB Update Error:', result.error);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'UPDATE_FAILED', message: 'Failed to update FCM token' })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'FCM token updated successfully',
                userId
            })
        };

    } catch (error) {
        console.error('Update FCM Token Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message: error.message })
        };
    }
};
