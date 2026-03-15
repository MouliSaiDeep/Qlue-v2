/**
 * Lambda handler for sending FCM push notifications when feedback is ready.
 */
const { sendNotification } = require('../../lib/firebase');
// const ddb = require('../../lib/dynamodb'); // Skip DB parts for now

exports.handler = async (event) => {
  const { userId, sessionId, overallScore, moduleType } = event;

  try {
    console.info(`Preparing notification for user ${userId}`);

    // 1. Fetch user record to get fcmToken
    // [DEFERRED] Skip for now as user model is placeholder.
    // In production, we'd fetch the user's latest fcmToken.
    const mockFcmToken = 'MOCK_TOKEN_' + userId; // Fallback for testing
    console.warn(`[MOCK] Using mock FCM token for user ${userId}`);

    // 2. Compose and send notification
    const notification = {
      title: 'Your Feedback is Ready!',
      body: `You scored ${overallScore}/10 in your ${moduleType} session. Tap to view details.`
    };

    const data = {
      sessionId,
      moduleType,
      type: 'FEEDBACK_READY',
      click_action: 'FLUTTER_NOTIFICATION_CLICK'
    };

    console.info(`Sending FCM to user ${userId}...`);
    const fcmResult = await sendNotification(mockFcmToken, notification, data);

    if (fcmResult.success) {
      console.info(`Notification sent successfully to ${userId}`);
    } else {
      console.warn(`FCM delivery failed for ${userId}: ${fcmResult.error}`);
      if (fcmResult.isStaleToken) {
        console.info(`FCM token for user ${userId} is stale. Flagging for removal.`);
      }
    }

    // 3. Log notification in DB
    // [DEFERRED] Skip as Notification model is not yet defined/accessible.
    console.info(`[DEFERRED] Logging notification record for user ${userId}`);

    return { success: fcmResult.success };

  } catch (error) {
    console.error(`Notification handler failed for user ${userId}:`, error);
    // Best-effort delivery: don't throw to stop Lambda retries unless it's a transient failure
    return { success: false, error: error.message };
  }
};
