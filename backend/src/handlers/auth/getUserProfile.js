const admin = require('../../lib/firebase');
const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient();
const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

const getUserProfile = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'MISSING_TOKEN', message: 'Authorization header is missing or invalid' });
        }

        const token = authHeader.split('Bearer ')[1].trim();

        let decodedToken;
        try {
            // Uses Firebase Admin native verification instead of custom JWT (to prevent 401 mismatch errors with your login tokens)
            decodedToken = await admin.auth().verifyIdToken(token);
        } catch (err) {
            return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Token verification failed or token expired' });
        }

        const firebaseUid = decodedToken.uid;

        // Fetch from DynamoDB using firebaseUid-index since Firebase tokens don't carry your custom userId internally
        const params = {
            TableName: USERS_TABLE,
            IndexName: 'firebaseUid-index',
            KeyConditionExpression: 'firebaseUid = :uid',
            ExpressionAttributeValues: {
                ':uid': firebaseUid
            }
        };

        const result = await dynamodb.query(params).promise();
        const user = result.Items && result.Items.length > 0 ? result.Items[0] : null;

        if (!user) {
            return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User record not found in database' });
        }

        const profileResponse = {
            userId: user.userId,
            email: user.email,
            displayName: user.displayName || user.name || '',
            photoUrl: user.photoUrl || '',
            createdAt: user.createdAt || Date.now()
        };

        return res.status(200).json(profileResponse);

    } catch (error) {
        console.error('Get Profile Error:', error);
        return res.status(500).json({ error: 'GET_PROFILE_FAILED', details: error.message });
    }
};

module.exports = { getUserProfile };
