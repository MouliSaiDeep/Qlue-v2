const { update } = require('../../lib/dynamodb');

const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

/**
 * AWS Lambda Handler: PUT /auth/profile
 */
exports.handler = async (event) => {
    try {
        const authorizer = event.requestContext?.authorizer;
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;

        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'User context missing' })
            };
        }

        const body = JSON.parse(event.body || '{}');
        const { displayName, photoUrl, profession, skills, voiceId } = body;

        if (displayName === undefined && photoUrl === undefined && profession === undefined && skills === undefined && voiceId === undefined) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'NO_UPDATE_FIELDS', message: 'Provide fields to update' })
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

        if (profession !== undefined) {
            updateExpression += ', profession = :profession';
            expressionAttributeValues[':profession'] = profession;
        }

        if (skills !== undefined) {
            updateExpression += ', skills = :skills';
            expressionAttributeValues[':skills'] = skills;
        }

        if (voiceId !== undefined) {
            // BE-BUG #9 FIX: Validate voiceId against allowed list before writing
            const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
            if (!allowedVoices.includes(voiceId)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({
                        error: 'INVALID_VOICE',
                        message: `voiceId '${voiceId}' is not allowed. Allowed values: ${allowedVoices.join(', ')}`
                    })
                };
            }
            updateExpression += ', voiceId = :voiceId';
            expressionAttributeValues[':voiceId'] = voiceId;
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
