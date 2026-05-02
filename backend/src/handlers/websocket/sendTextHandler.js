const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getSession, getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { deregisterConnection } = require('../../lib/websocket');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ASYNC_QUEUE_URL = process.env.ASYNC_QUEUE_URL;
const WS_CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE;

const apigwClient = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT?.replace('wss://', 'https://') || ''
});

async function postToConnection(connectionId, data) {
  try {
    await apigwClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data))
    }));
    return true;
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 410 || error.name === 'GoneException') {
      console.warn(`Connection ${connectionId} is stale`);
      await deregisterConnection(connectionId);
      throw new Error('StaleConnectionError');
    }
    throw error;
  }
}

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

    const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
    const finalVoiceId = allowedVoices.includes(voiceId) ? voiceId : (session.voiceId || 'Tiffany');
    const finalEngine = ['neural', 'standard', 'long-form', 'generative'].includes(engine) ? engine : 'neural';

    await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, null, {
      connectionId,
      voiceId: finalVoiceId,
      engine: finalEngine
    });

    const dynamodb = require('../../lib/dynamodb');
    await dynamodb.put(WS_CONNECTIONS_TABLE, {
      connectionId,
      sessionId,
      userId,
      isActive: 'true',
      connectedAt: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + (2 * 60 * 60)
    });

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: ASYNC_QUEUE_URL,
      MessageBody: JSON.stringify({
        connectionId,
        sessionId,
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

    await updateSessionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE);

    const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
    const finalVoiceId = allowedVoices.includes(voiceId) ? voiceId : (session.voiceId || 'Tiffany');
    const finalEngine = ['neural', 'standard', 'long-form', 'generative'].includes(engine) ? engine : (session.engine || 'neural');

    console.log(`[turn_submit] Session ${sessionId} | Voice: ${finalVoiceId} | Engine: ${finalEngine}`);

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: ASYNC_QUEUE_URL,
      MessageBody: JSON.stringify({
        connectionId,
        sessionId,
        body: { textTranscript, isSilence, currentConceptId },
        action: 'turn_submit',
        voiceId: finalVoiceId,
        engine: finalEngine
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
    const dynamodb = require('../../lib/dynamodb');
    await dynamodb.put(WS_CONNECTIONS_TABLE, {
      connectionId,
      sessionId,
      userId,
      isActive: 'true',
      connectedAt: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + (2 * 60 * 60)
    });

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
    
    if (isStale && (session.currentState === INTERVIEW_STATES.AI_SPEAKING || session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE)) {
      await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
      await postToConnection(connectionId, {
        type: 'turn_complete',
        payload: {
          sessionId,
          turnIndex: session.turnCount || 0,
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
          turnIndex: session.turnCount || 0,
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
          turnIndex: session.turnCount || 0,
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
    const { terminateSession } = require('../interview/terminateSession');
    await terminateSession.handler({
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
        await postToConnection(connectionId, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        console.warn(`Unknown message type: ${body.type}`);
    }
  } catch (error) {
    console.error('WebSocket handler error:', error);
    await sendError(connectionId, 'Internal server error');
  }

  return { statusCode: 200 };
};
