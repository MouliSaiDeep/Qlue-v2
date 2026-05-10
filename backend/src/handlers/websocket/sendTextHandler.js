const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getSession, getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { getTranscriptBySession, getLatestTranscripts } = require('../../models/transcript');
const { deregisterConnection } = require('../../lib/websocket');
const { docClient } = require('../../lib/dynamodb');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ASYNC_QUEUE_URL = process.env.ASYNC_QUEUE_URL;
const WS_CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE;

async function sendError(connectionId, message, code = 400) {
  try {
    await postToConnection(connectionId, {
      type: 'turn_error',
      payload: { error: message, code, timestamp: Date.now() }
    });
  } catch (e) {
    console.error('Failed to send error:', e);
  }
}

async function updateConnectionHeartbeat(connectionId) {
  if (!connectionId) return;
  try {
    await docClient.send(new UpdateCommand({
      TableName: WS_CONNECTIONS_TABLE,
      Key: { connectionId },
      UpdateExpression: 'SET lastHeartbeat = :heartbeat, #ttl = :ttl',
      ConditionExpression: 'attribute_not_exists(connectionId) OR isActive = :active',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':heartbeat': Date.now(),
        ':active': 'true',
        ':ttl': Math.floor(Date.now() / 1000) + (2 * 60 * 60)
      }
    }));
  } catch (err) {
    console.warn(`Failed to refresh heartbeat for ${connectionId}:`, err);
  }
}

async function getLastAiTurnIndex(sessionId, sessionTurnCount = 0) {
  try {
    const transcripts = await getLatestTranscripts(sessionId, 5);
    for (const item of transcripts) {
      if (item.speaker === 'AI') {
        return Number(item.turnIndex) || 0;
      }
    }
  } catch (err) {
    console.warn(`Unable to resolve last AI turn index for session ${sessionId}:`, err);
  }
  return Math.max(0, (sessionTurnCount || 1) - 1);
}

async function handleSessionInit(connectionId, body, userId) {
  const { sessionId, moduleType, resumeId, websiteUrl, voiceId, engine } = body;

  if (!sessionId) {
    return await sendError(connectionId, 'sessionId is required for session_init');
  }

  try {
    const session = await getSessionById(sessionId);
    if (!session) {
      return await sendError(connectionId, `Session ${sessionId} not found`);
    }

    // BUG-2 FIX: Validate session ownership
    if (session.userId !== userId) {
      return await sendError(connectionId, 'Forbidden: Session does not belong to this user', 403);
    }

    const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
    const finalVoiceId = allowedVoices.includes(voiceId) ? voiceId : (session.voiceId || 'Tiffany');
    
    // Force generative engine universally
    const finalEngine = 'generative';
    // Do not advance session state here; asyncWorker owns session initialization state transitions.

    // BUG-4 FIX: Use UpdateCommand with attribute_not_exists to prevent overwrite race
    try {
      await docClient.send(new UpdateCommand({
        TableName: WS_CONNECTIONS_TABLE,
        Key: { connectionId },
        UpdateExpression: 'SET sessionId = :sessionId, userId = :userId, isActive = :active, connectedAt = :connectedAt, #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(connectionId) OR isActive = :active',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':sessionId': sessionId,
          ':userId': userId,
          ':active': 'true',
          ':connectedAt': Date.now(),
          ':ttl': Math.floor(Date.now() / 1000) + (2 * 60 * 60)
        }
      }));
    } catch (updateErr) {
      if (updateErr.name === 'ConditionalCheckFailedException') {
        console.warn(`Connection ${connectionId} mapping failed: condition not met`);
        return await sendError(connectionId, 'Session initialization failed: connection state conflict', 409);
      } else {
        throw updateErr;
      }
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: ASYNC_QUEUE_URL,
      MessageBody: JSON.stringify({
        connectionId,
        sessionId,
        userId,   // BE-BUG #17 FIX: pass userId so asyncWorker can call handlers with ownership context
        action: 'session_init',
        voiceId: finalVoiceId,
        engine: finalEngine
      })
    }));

    console.log(`[session_init] Queued for ${sessionId} with voice ${finalVoiceId}`);

  } catch (err) {
    console.error('session_init error:', err);
    await sendError(connectionId, err.message);
  }
}

async function handleTurnSubmit(connectionId, body, userId) {
  const { sessionId, textTranscript, isSilence, currentConceptId, voiceId, engine } = body;

  if (!sessionId) {
    return await sendError(connectionId, 'sessionId is required for turn_submit');
  }

  try {
    const session = await getSessionById(sessionId);

    if (!session || session.currentState === INTERVIEW_STATES.TERMINATED) {
      return await sendError(connectionId, 'Session is terminated');
    }
    if (session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
      await postToConnection(connectionId, { 
        type: 'termination', 
        payload: { sessionId, reason: 'GENERATING_FEEDBACK' }
      });
      return;
    }
    if (session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE || session.currentState === INTERVIEW_STATES.AI_SPEAKING) {
      return await sendError(connectionId, 'TURN_IN_PROGRESS', 409);
    }

    // BUG-2 FIX: Validate session ownership
    if (session.userId !== userId) {
      return await sendError(connectionId, 'Forbidden: Session does not belong to this user', 403);
    }

    // BUG-3 FIX: Make state update atomic - only update if currently USER_RESPONDING
    try {
      await updateSessionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.USER_RESPONDING);
    } catch (stateErr) {
      if (stateErr.name === 'ConditionalCheckFailedException') {
        return await sendError(connectionId, 'Session state changed; turn submission cancelled', 409);
      }
      throw stateErr;
    }

    if (!textTranscript && !isSilence) {
      return await sendError(connectionId, 'textTranscript is required when not marked as silence', 400);
    }

    const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
    const finalVoiceId = allowedVoices.includes(voiceId) ? voiceId : (session.voiceId || 'Tiffany');
    
    // Force generative engine universally
    const finalEngine = 'generative';

    console.log(`[turn_submit] Session ${sessionId} | Voice: ${finalVoiceId} | Engine: ${finalEngine}`);

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: ASYNC_QUEUE_URL,
      MessageBody: JSON.stringify({
        connectionId,
        sessionId,
        userId,
        body: { textTranscript, isSilence, currentConceptId },
        action: 'turn_submit',
        voiceId: finalVoiceId,
        engine: finalEngine,
        expectedTurnCount: session.turnCount || 0
      })
    }));

  } catch (err) {
    console.error('turn_submit error:', err);
    await sendError(connectionId, err.message);
  }
}

async function handleSessionReconnect(connectionId, body, userId) {
  const { sessionId } = body;
  
  if (!sessionId) {
    return await sendError(connectionId, 'sessionId required');
  }

  try {
    const session = await getSessionById(sessionId);
    if (!session) {
      return await sendError(connectionId, 'Session not found');
    }

    // Update connection mapping
    try {
      await docClient.send(new UpdateCommand({
        TableName: WS_CONNECTIONS_TABLE,
        Key: { connectionId },
        UpdateExpression: 'SET sessionId = :sessionId, userId = :userId, isActive = :active, connectedAt = :connectedAt, #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(connectionId) OR isActive = :active',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':sessionId': sessionId,
          ':userId': userId,
          ':active': 'true',
          ':connectedAt': Date.now(),
          ':ttl': Math.floor(Date.now() / 1000) + (2 * 60 * 60)
        }
      }));
    } catch (updateErr) {
      if (updateErr.name === 'ConditionalCheckFailedException') {
        console.warn(`Connection ${connectionId} reconnection failed: condition not met`);
        return await sendError(connectionId, 'Session reconnection failed: connection state conflict', 409);
      } else {
        throw updateErr;
      }
    }

    if (session.currentState === INTERVIEW_STATES.TERMINATED || session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
      await postToConnection(connectionId, {
        type: 'termination',
        payload: { sessionId, reason: session.currentState }
      });
      return;
    }

    // If stuck in AI_SPEAKING/PROCESSING for >30s, recover
    const staleThreshold = 30000;
    const isStale = session.updatedAt && (Date.now() - session.updatedAt > staleThreshold);
    const lastAiTurnIndex = await getLastAiTurnIndex(sessionId, session.turnCount || 0);
    
    if (isStale && (session.currentState === INTERVIEW_STATES.AI_SPEAKING || session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE)) {
      await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
      await postToConnection(connectionId, {
        type: 'turn_complete',
        payload: {
          sessionId,
          turnIndex: lastAiTurnIndex,
          questionText: session.questionText || 'Welcome back. Please respond when ready.',
          audioData: '',
          audioUrl: '',
          state: INTERVIEW_STATES.USER_RESPONDING,
          timestamp: Date.now()
        }
      });
      return;
    }

    // Normal reconnect: send current state
    if (session.currentState === INTERVIEW_STATES.USER_RESPONDING && session.questionText) {
      await postToConnection(connectionId, {
        type: 'turn_complete',
        payload: {
          sessionId,
          turnIndex: lastAiTurnIndex,
          questionText: session.questionText,
          audioData: '',
          audioUrl: '',
          state: INTERVIEW_STATES.USER_RESPONDING,
          timestamp: Date.now()
        }
      });
    } else {
      await postToConnection(connectionId, {
        type: 'turn_complete',
        payload: {
          sessionId,
          turnIndex: lastAiTurnIndex,
          questionText: 'Welcome back. Please respond when ready.',
          audioData: '',
          audioUrl: '',
          state: INTERVIEW_STATES.USER_RESPONDING,
          timestamp: Date.now()
        }
      });
    }

  } catch (err) {
    console.error('session_reconnect error:', err);
    await sendError(connectionId, err.message);
  }
}

async function handleTerminateSession(connectionId, body, userId) {
  const { sessionId, reason = 'USER_INITIATED' } = body;

  if (!sessionId) {
    return await sendError(connectionId, 'sessionId required');
  }

  try {
    const terminateSession = require('../interview/terminateSession');
    await terminateSession.handler({
      requestContext: {
        authorizer: {
          uid: userId
        }
      },
      body: JSON.stringify({ sessionId, reason })
    });

    try {
      await postToConnection(connectionId, {
        type: 'termination',
        payload: { sessionId, reason, timestamp: Date.now() }
      });
    } catch (wsErr) {
      if (wsErr.message === 'StaleConnectionError') {
        console.warn(`Stale connection during termination for ${sessionId}`);
      } else {
        throw wsErr;
      }
    }

  } catch (err) {
    console.error('terminate_session error:', err);
    await sendError(connectionId, err.message);
  }
}

exports.handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  const routeKey = event.requestContext?.routeKey;
  const body = JSON.parse(event.body || '{}');
  const userId = event.requestContext?.authorizer?.uid || body.userId;

  if (!userId) {
    console.error('WebSocket message missing userId');
    return await sendError(connectionId, 'userId required');
  }

  console.log(`Received WS message [${body.type || routeKey}] from connection ${connectionId}`);

  try {
    switch (body.type || routeKey) {
      case 'session_init':
        await handleSessionInit(connectionId, body.payload || body, userId);
        break;
      case 'turn_submit':
        await handleTurnSubmit(connectionId, body.payload || body, userId);
        break;
      case 'session_reconnect':
        await handleSessionReconnect(connectionId, body.payload || body, userId);
        break;
      case 'terminate_session':
        await handleTerminateSession(connectionId, body.payload || body, userId);
        break;
      case 'ping':
        await updateConnectionHeartbeat(connectionId);
        await postToConnection(connectionId, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        console.warn(`Unknown message type: ${body.type}`);
        await sendError(connectionId, `Unknown message type: ${body.type || routeKey}`);
    }
  } catch (error) {
    console.error('WebSocket handler error:', error);
    await sendError(connectionId, 'Internal server error');
  }

  return { statusCode: 200 };
};
