const admin = require('../../lib/firebase');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamodb = new AWS.DynamoDB.DocumentClient();
const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

const findUserByFirebaseUid = async (firebaseUid) => {
  const params = {
    TableName: USERS_TABLE,
    IndexName: 'firebaseUid-index',
    KeyConditionExpression: 'firebaseUid = :uid',
    ExpressionAttributeValues: {
      ':uid': firebaseUid,
    },
  };

  const result = await dynamodb.query(params).promise();
  return result.Items && result.Items.length > 0 ? result.Items[0] : null;
};

const createUser = async (userData) => {
  const now = Date.now();
  const item = {
    userId: `usr-${uuidv4()}`,
    email: userData.email.toLowerCase(),
    displayName: userData.displayName ? userData.displayName.substring(0, 50) : 'User',
    photoUrl: userData.photoUrl || '',
    authProvider: 'GOOGLE_OAUTH',
    firebaseUid: userData.firebaseUid,
    createdAt: now,
    updatedAt: now,
  };

  const params = {
    TableName: USERS_TABLE,
    Item: item,
  };

  await dynamodb.put(params).promise();
  return item;
};

const loginWithGoogle = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken || idToken.trim() === '') {
      return res.status(400).json({ error: 'INVALID_ID_TOKEN', message: 'You must provide a valid Firebase idToken string in the body.' });
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.error('Firebase token verification failed:', err.message);
      return res.status(401).json({ error: 'INVALID_ID_TOKEN' });
    }

    const firebaseUid = decodedToken.uid;
    const email = (decodedToken.email || '').toLowerCase();
    const displayName = decodedToken.name || decodedToken.displayName || 'User';
    const photoUrl = decodedToken.picture || '';

    let user;
    let isNewUser = false;

    const existingUser = await findUserByFirebaseUid(firebaseUid);

    if (existingUser) {
      user = existingUser;
      isNewUser = false;
    } else {
      user = await createUser({ email, displayName, photoUrl, firebaseUid });
      isNewUser = true;
    }

    // Since we are relying natively on Firebase tokens across the app (reverted architecture),
    // we don't generate custom JWTs here. The frontend already possesses its Firebase tokens!
    return res.status(200).json({
      message: "Google login successful",
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      photoUrl: user.photoUrl,
      isNewUser,
    });
  } catch (error) {
    console.error('Google Auth Error:', error);
    return res.status(500).json({ error: 'GOOGLE_AUTH_FAILED' });
  }
};

module.exports = { loginWithGoogle };
