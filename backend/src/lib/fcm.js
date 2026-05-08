/**
 * Helper for Firebase Cloud Messaging operations.
 */
const { admin, initializeFirebase } = require('./firebase');
const { delete: deleteDdb } = require('./dynamodb'); // Use to clean up invalid tokens

/**
 * Sends a notification to a specific device token.
 */
async function sendNotification(fcmToken, notification) {
  await initializeFirebase();
  
  const message = {
    token: fcmToken,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: notification.data || {}
  };

  try {
    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('FCM send error', error);
    // Handle obsolete tokens
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      return { success: false, reason: 'INVALID_TOKEN' };
    }
    return { success: false, error };
  }
}

/**
 * Multicast a notification to an array of tokens.
 */
async function sendMulticastNotification(tokens, notification) {
  await initializeFirebase();

  if (!tokens || tokens.length === 0) return { success: true };

  const message = {
    tokens: tokens,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: notification.data || {}
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    
    const invalidTokens = [];
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          if (resp.error.code === 'messaging/invalid-registration-token' ||
              resp.error.code === 'messaging/registration-token-not-registered') {
            invalidTokens.push(tokens[idx]);
          }
        }
      });
    }

    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens 
    };
  } catch (error) {
    console.error('FCM multicast error', error);
    return { success: false, error };
  }
}

/**
 * Pre-configured payload wrapper for feedback generation completition
 */
async function sendFeedbackReadyNotification(userId, sessionId, fcmToken) {
  if (!fcmToken) return { success: false, reason: 'NO_TOKEN' };

  const notification = {
    title: 'Your Interview Feedback is Ready! 🎉',
    body: 'Tap to view your detailed module scores and analytical feedback.',
    data: {
      action: 'VIEW_FEEDBACK',
      sessionId: sessionId
    }
  };

  const response = await sendNotification(fcmToken, notification);
  
  // Clean token from DB if invalid
  if (!response.success && response.reason === 'INVALID_TOKEN') {
    // Note: Depends on the precise table architecture, assuming Users table holds fcmToken natively
    // Callers should implement cleanup logic if token is invalid
    console.warn(`[FCM] Token invalid for user ${userId}, it should be cleaned up.`);
  }

  return response;
}

module.exports = {
  sendNotification,
  sendMulticastNotification,
  sendFeedbackReadyNotification
};
