const { update } = require('../../lib/dynamodb');

const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

/**
 * AWS Lambda Handler: PUT /auth/profile
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
        const { displayName, photoUrl } = body;

        if (displayName === undefined && photoUrl === undefined) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'NO_UPDATE_FIELDS', message: 'Provide displayName or photoUrl' })
            };
        }

        if (displayName && displayName.length > 50) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'INVALID_INPUT', message: 'displayName too long' })
            };
        }

        let updateExpression = 'SET updatedAt = :updatedAt';
        const expressionAttributeValues = {
            ':updatedAt': new Date().toISOString()
        };

        if (displayName !== undefined) {
            updateExpression += ', displayName = :displayName';
            expressionAttributeValues[':displayName'] = displayName;
        }

        if (photoUrl !== undefined) {
            updateExpression += ', photoUrl = :photoUrl';
            expressionAttributeValues[':photoUrl'] = photoUrl;
        }

        const result = await update(
            USERS_TABLE,
            { userId },
            updateExpression,
            expressionAttributeValues
        );

        if (!result.success) {
            return {
                statusCode: result.error?.name === 'ConditionalCheckFailedException' ? 404 : 500,
                body: JSON.stringify({ error: 'UPDATE_FAILED', details: result.error?.message })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Profile updated successfully',
                user: result.data
            })
        };

    } catch (error) {
        console.error('Update Profile Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'UPDATE_PROFILE_FAILED', details: error.message })
        };
    }
};
