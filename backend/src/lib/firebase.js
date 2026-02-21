/**
 * Wrapper for Firebase Admin Initialization and user auth utilities.
 */
const admin = require('firebase-admin');
const { getFirebaseServiceAccount } = require('./secrets');
const { ERROR_CODES, QlueError } = require('./errors');

let isInitialized = false;

/**
 * Lazily initialize the Firebase Admin app
 */
async function initializeFirebase() {
  if (isInitialized && admin.apps.length > 0) {
    return;
  }

  try {
    const serviceAccountJson = await getFirebaseServiceAccount();
    const serviceAccount = typeof serviceAccountJson === 'string' 
      ? JSON.parse(serviceAccountJson) 
      : serviceAccountJson;

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    isInitialized = true;
    console.debug('Firebase admin initialized.');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin', error);
    throw new QlueError('Firebase init failed', ERROR_CODES.INTERNAL_ERROR);
  }
}

/**
 * Verify ID token sent from Flutter client
 */
async function verifyIdToken(token) {
  await initializeFirebase();
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    if (error.code === 'auth/id-token-expired') {
      throw new QlueError('Token expired', ERROR_CODES.TOKEN_EXPIRED, 401);
    }
    throw new QlueError('Invalid token', ERROR_CODES.TOKEN_INVALID, 401, error.message);
  }
}

/**
 * Create custom token for users authenticating via alternate flows
 */
async function createCustomToken(uid) {
  await initializeFirebase();
  try {
    return await admin.auth().createCustomToken(uid);
  } catch (error) {
    throw new QlueError('Could not create custom token', ERROR_CODES.INTERNAL_ERROR, 500, error.message);
  }
}

/**
 * Delete a user from Firebase Auth
 */
async function deleteUser(uid) {
  await initializeFirebase();
  try {
    await admin.auth().deleteUser(uid);
    return true;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return false;
    }
    throw new QlueError('Could not delete user', ERROR_CODES.INTERNAL_ERROR, 500, error.message);
  }
}

/**
 * Retrieve user profile by email
 */
async function getUserByEmail(email) {
  await initializeFirebase();
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return null;
    }
    throw new QlueError('Could not get user', ERROR_CODES.INTERNAL_ERROR, 500, error.message);
  }
}

/**
 * Sends an FCM push notification.
 */
async function sendNotification(fcmToken, notification, data = {}) {
  await initializeFirebase();
  try {
    const message = {
      notification,
      data,
      token: fcmToken
    };

    const response = await admin.messaging().send(message);
    console.info('Successfully sent FCM message:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('Error sending FCM message:', error);
    return { 
      success: false, 
      error: error.message, 
      isStaleToken: error.code === 'messaging/registration-token-not-registered' || 
                    error.code === 'messaging/invalid-registration-token'
    };
  }
}

module.exports = {
  initializeFirebase,
  verifyIdToken,
  createCustomToken,
  deleteUser,
  getUserByEmail,
  sendNotification,
  admin
};
