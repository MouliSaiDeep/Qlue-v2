const diagnostics=require('../../lib/logger').safeConsole;
/**
 * Lambda handler for sending FCM push notifications when feedback is ready.
 */
const { sendNotification } = require('../../lib/firebase');
// const ddb = require('../../lib/dynamodb'); // Skip DB parts for now

exports.handler = async (event) => {
  const { userId, sessionId, overallScore, moduleType } = event;

  try {
    await require('../../lib/deletionJob').assertNotDeleting(userId);
    diagnostics.info(`Preparing notification for user ${userId}`);

    // 1. Fetch user record to get fcmToken
    const { getUserById } = require('../../models/user');
    const user = await getUserById(userId);
    if (!user || !user.fcmToken) {
      diagnostics.warn(`No FCM token found for user ${userId}. Skipping notification.`);
      return { success: false, error: 'No FCM token' };
    }
    const fcmToken = user.fcmToken;

    // 2. Compose and send notification
    const notification = {
      title: 'Your Feedback is Ready!',
      body: `You scored ${Math.round(overallScore)}/100 in your ${moduleType} session. Tap to view details.`
    };

    const data = {
      sessionId,
      userId,
      feedbackId:event.feedbackId||sessionId,
      moduleType,
      type: 'FEEDBACK_READY',
      click_action: 'FLUTTER_NOTIFICATION_CLICK'
    };

    diagnostics.info(`Sending FCM to user ${userId}...`);
    if(event.attemptId&&!await require('../../lib/feedbackAttempt').currentAttempt(event)) return {success:false,stale:true};
    const fcmResult = await require('../../lib/deadline').bounded(()=>sendNotification(fcmToken, notification, data),{label:'pushDelivery'});

    if (fcmResult.success) {
      diagnostics.info(`Notification sent successfully to ${userId}`);
    } else {
      diagnostics.warn(`FCM delivery failed for ${userId}: ${fcmResult.error}`);
      // BE-BUG #18 FIX: actually remove a dead token instead of only logging a
      // "should be cleaned up" warning. Conditional on the token still matching
      // so a token uploaded after this send (refresh / account switch) is not
      // wiped. Cleanup failure must not fail the notification handler.
      if (fcmResult.isStaleToken) {
        try {
          const { clearFcmToken } = require('../../models/user');
          const cleanup = await clearFcmToken(userId, { ifMatches: fcmToken });
          diagnostics.info(
            `Stale FCM token for user ${userId} ${cleanup.skipped ? 'already rotated' : 'removed'}.`
          );
        } catch (cleanupErr) {
          diagnostics.error(`Failed to clear stale FCM token for ${userId}:`, cleanupErr.name);
        }
      } else {
        throw new Error('Transient notification delivery failure');
      }
    }

    // 3. Log notification in DB
    // [DEFERRED] Skip as Notification model is not yet defined/accessible.
    diagnostics.info(`[DEFERRED] Logging notification record for user ${userId}`);

    return { success: fcmResult.success };

  } catch (error) {
    diagnostics.error(`Notification handler failed for user ${userId}:`, error);
    throw error;
  }
};
