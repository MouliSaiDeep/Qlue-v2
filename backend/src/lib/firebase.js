const diagnostics=require('./logger').safeConsole;
/**
 * Wrapper for Firebase Admin Initialization and user auth utilities.
 */
const sdk = require('firebase-admin/app');
const { getFirebaseServiceAccount } = require('./secrets');
const { ERROR_CODES, QlueError } = require('./errors');

let isInitialized = false;

/**
 * Lazily initialize the Firebase Admin app
 */
async function initializeFirebase() {
  if (isInitialized && sdk.getApps().length > 0) {
    return;
  }

  try {
    // Use the configured secret in every environment. An incidental local key
    // file must never override the deployed identity or enter a release package.
    const serviceAccountJson = await getFirebaseServiceAccount();
    const serviceAccount = typeof serviceAccountJson === 'string'
      ? JSON.parse(serviceAccountJson) : serviceAccountJson;

    // Standard credential loading (no more cleaning needed as we have a clean JSON now)
    if (sdk.getApps().length === 0) {
      sdk.initializeApp({
        credential: sdk.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      diagnostics.log('Firebase Admin initialized');
    }
    
    isInitialized = true;
  } catch (error) {
    diagnostics.error('!!! FIREBASE INITIALIZATION FAILED !!!', error);
    throw new QlueError('Firebase init failed', ERROR_CODES.INTERNAL_ERROR, 500, error.message);
  }
}

/**
 * Get the Auth service instance with guaranteed initialization
 */
async function getAuth() {
  await initializeFirebase();
  return require('firebase-admin/auth').getAuth();
}

/**
 * Get the Messaging service instance with guaranteed initialization
 */
async function getMessaging() {
  await initializeFirebase();
  return require('firebase-admin/messaging').getMessaging();
}

/**
 * Verify an ID token sent from the Flutter client.
 *
 * @param {string} token          the Firebase ID token
 * @param {boolean} [checkRevoked] when true, Firebase additionally checks that
 *   the token has not been revoked (sign-out-everywhere, password reset,
 *   account deletion) and that the user is not disabled. The REST authorizer
 *   passes true; the WebSocket $connect path MUST also pass true so a revoked
 *   session cannot open a socket that then lives for the full ttl (finding 16).
 */
async function verifyIdToken(token, checkRevoked = false) {
  const auth = await getAuth();
  try {
    const decodedToken = await auth.verifyIdToken(token, checkRevoked);
    return decodedToken;
  } catch (error) {
    // A revoked token means the credential is no longer valid but the client
    // can recover by refreshing (it will then fail to get a new token if the
    // account is truly gone); surface it like an expiry so the client re-auths.
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/id-token-revoked') {
      throw new QlueError('Token expired', ERROR_CODES.TOKEN_EXPIRED, 401);
    }
    // A disabled/deleted account is terminal — the client must sign out.
    if (error.code === 'auth/user-disabled') {
      throw new QlueError('Account disabled', ERROR_CODES.TOKEN_INVALID, 401, error.code);
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
      android:{collapseKey:data.sessionId,notification:{tag:data.feedbackId||data.sessionId}},
      token: fcmToken
    };

    const response = await require('./deadline').bounded(()=>messaging.send(message),{label:'fcm'});
    diagnostics.info('Successfully sent FCM message:', response);
    return { success: true, messageId: response };
  } catch (error) {
    diagnostics.error('Error sending FCM message:', error);
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
