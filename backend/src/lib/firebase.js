/**
 * Wrapper for Firebase Admin Initialization and user auth utilities.
 */
const sdk = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const { getFirebaseServiceAccount } = require('./secrets');
const { ERROR_CODES, QlueError } = require('./errors');

let isInitialized = false;

/**
 * Lazily initialize the Firebase Admin app
 */
async function initializeFirebase() {
  if (isInitialized && sdk.apps.length > 0) {
    return;
  }

  try {
    let serviceAccount;
    
    // 1. Load from the new service-account-local.json file (Absolute path for Windows reliability)
    const localKeyPath = path.resolve(process.cwd(), 'service-account-local.json');
    
    if (fs.existsSync(localKeyPath)) {
      console.log(`>>> INITIALIZING FIREBASE FROM FILE: ${localKeyPath}`);
      const content = fs.readFileSync(localKeyPath, 'utf8');
      serviceAccount = JSON.parse(content);
    } else {
      console.log('>>> LOCAL FILE NOT FOUND. FALLING BACK TO ENV/SECRETS.');
      const serviceAccountJson = await getFirebaseServiceAccount();
      serviceAccount = typeof serviceAccountJson === 'string' 
        ? JSON.parse(serviceAccountJson) 
        : serviceAccountJson;
    }

    // Standard credential loading (no more cleaning needed as we have a clean JSON now)
    if (sdk.apps.length === 0) {
      sdk.initializeApp({
        credential: sdk.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      console.log('>>> FIREBASE ADMIN INITIALIZED SUCCESSFULLY! <<<');
    }
    
    isInitialized = true;
  } catch (error) {
    console.error('!!! FIREBASE INITIALIZATION FAILED !!!', error);
    throw new QlueError('Firebase init failed', ERROR_CODES.INTERNAL_ERROR, 500, error.message);
  }
}

/**
 * Get the Auth service instance with guaranteed initialization
 */
async function getAuth() {
  await initializeFirebase();
  return sdk.auth();
}

/**
 * Get the Messaging service instance with guaranteed initialization
 */
async function getMessaging() {
  await initializeFirebase();
  return sdk.messaging();
}

/**
 * Verify ID token sent from Flutter client
 */
async function verifyIdToken(token) {
  const auth = await getAuth();
  try {
    const decodedToken = await auth.verifyIdToken(token);
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
  const auth = await getAuth();
  try {
    return await auth.createCustomToken(uid);
  } catch (error) {
    throw new QlueError('Could not create custom token', ERROR_CODES.INTERNAL_ERROR, 500, error.message);
  }
}

/**
 * Delete a user from Firebase Auth
 */
async function deleteUser(uid) {
  const auth = await getAuth();
  try {
    await auth.deleteUser(uid);
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
  const auth = await getAuth();
  try {
    return await auth.getUserByEmail(email);
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
  const messaging = await getMessaging();
  try {
    const message = {
      notification,
      data,
      token: fcmToken
    };

    const response = await messaging.send(message);
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
  getAuth,
  getMessaging,
  initializeFirebase,
  verifyIdToken,
  createCustomToken,
  deleteUser,
  getUserByEmail,
  sendNotification,
  sdk 
};
