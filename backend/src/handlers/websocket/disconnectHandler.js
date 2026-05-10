/**
 * WebSocket $disconnect route handler.
 * Implements Stranded State Revert to prevent Ghost Speaking Lockout.
 */
const { getConnection, deactivateConnection } = require('../../models/wsConnection');
const { getSession, getActiveSessionForUser, updateSessionState, INTERVIEW_STATES } = require('../../models/session');

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  try {
    // 1. Get the session associated with the dropping connection
    const connectionRecord = await getConnection(connectionId);

    let sessionId = connectionRecord?.sessionId;

    // BE-BUG #20 FIX: If connectionRecord has no sessionId, look up active session by userId
    if (!sessionId && connectionRecord?.userId) {
      const activeSession = await getActiveSessionForUser(connectionRecord.userId);
      if (activeSession) {
        sessionId = activeSession.sessionId;
        console.warn(`[Disconnect Guard] No sessionId on connectionRecord, found active session ${sessionId} via userId ${connectionRecord.userId}`);
      }
    }

    if (sessionId) {
      const session = await getSession(sessionId);

      // 2. GHOST STATE PREVENTION:
      // If the connection drops while the DB is locked, the audio stream is dead.
      // Revert to USER_RESPONDING so the UI unlocks when the user reconnects.
      if (session && (session.currentState === INTERVIEW_STATES.AI_SPEAKING || session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE)) {
        console.warn(`[Disconnect Guard] Session ${sessionId} stranded in ${session.currentState}. Reverting to USER_RESPONDING.`);

        // Try/catch suppresses conditional check failures if Bedrock is actively moving the state
        try {
          await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, session.currentState, { message: 'Connection dropped. Reverted.' });
        } catch (err) {
          console.warn(`[Disconnect Guard] State safely moved by another process: ${err.message}`);
        }
      }
    }

    // 3. Clean up the connection record
    await deactivateConnection(connectionId);

    console.info(`Successfully processed disconnect for connectionId: ${connectionId}`);
    return { statusCode: 200 };
  } catch (error) {
    console.error('[Disconnect Error]', error);
    // Standard practice for $disconnect: always return 200 to AWS
    return { statusCode: 200 };
  }
};
