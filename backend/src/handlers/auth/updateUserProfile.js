const admin = require('../../lib/firebase');
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient();
const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

const updateUserProfile = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'MISSING_TOKEN', message: 'Authorization header is missing or invalid' });
        }

        const token = authHeader.split('Bearer ')[1].trim();

        let decodedToken;
        try {
            // Updated to native Firebase verification so it works perfectly with your login tokens in Postman!
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (err) {
            return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Token verification failed or expired' });
        }

        const firebaseUid = decodedToken.uid;

        // Fetch user from DB first using firebaseUid-index to get their internal userId
        const getUserParams = {
            TableName: USERS_TABLE,
            IndexName: 'firebaseUid-index',
            KeyConditionExpression: 'firebaseUid = :uid',
            ExpressionAttributeValues: { ':uid': firebaseUid }
        };

        const resultUser = await dynamodb.query(getUserParams).promise();
        const userRec = resultUser.Items && resultUser.Items.length > 0 ? resultUser.Items[0] : null;

        if (!userRec) {
            return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Token valid but user not found in DynamoDB.' });
        }

        const userId = userRec.userId;

        const { displayName, photoUrl } = req.body;

        if (displayName === undefined && photoUrl === undefined) {
            return res.status(400).json({ error: 'NO_UPDATE_FIELDS', message: 'Please provide displayName or photoUrl to update' });
        }

        if (displayName && displayName.length > 50) {
            return res.status(400).json({ error: 'INVALID_INPUT', message: 'displayName cannot exceed 50 characters' });
        }

        if (photoUrl) {
            try {
                new URL(photoUrl); 
            } catch (err) {
                 return res.status(400).json({ error: 'INVALID_INPUT', message: 'photoUrl must be a valid URL string' });
            }
        }

        let updateExpression = 'SET updatedAt = :updatedAt';
        const expressionAttributeValues = {
            ':updatedAt': Date.now()
        };

        if (displayName !== undefined) {
            updateExpression += ', displayName = :displayName';
            expressionAttributeValues[':displayName'] = displayName;
        }

        if (photoUrl !== undefined) {
            updateExpression += ', photoUrl = :photoUrl';
            expressionAttributeValues[':photoUrl'] = photoUrl;
        }

        const updateParams = {
            TableName: USERS_TABLE,
            Key: { userId: userId },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW',
            ConditionExpression: 'attribute_exists(userId)' 
        };

        let result;
        try {
             result = await dynamodb.update(updateParams).promise();
        } catch (dbErr) {
            if (dbErr.code === 'ConditionalCheckFailedException') {
                 return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User record not found in database' });
            }
            throw dbErr;
        }

        const updatedUser = result.Attributes;

        return res.status(200).json({
            message: 'Profile updated successfully',
            user: {
                userId: updatedUser.userId,
                email: updatedUser.email,
                displayName: updatedUser.displayName,
                photoUrl: updatedUser.photoUrl,
                updatedAt: updatedUser.updatedAt
            }
        });

    } catch (error) {
        console.error('Update Profile Error:', error);
        return res.status(500).json({ error: 'UPDATE_PROFILE_FAILED', details: error.message });
    }
};

module.exports = { updateUserProfile };
