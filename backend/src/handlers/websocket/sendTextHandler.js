const diagnostics=require('../../lib/logger').safeConsole;
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getSession, getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { getTranscriptBySession, getLatestTranscripts } = require('../../models/transcript');
// BUG FIX: postToConnection was used throughout this handler but never
// imported, so every pong / turn_error / reconnect reply threw a silent
// ReferenceError inside try/catch blocks and never reached the client.
const { postToConnection, deregisterConnection } = require('../../lib/websocket');
const { getConnection } = require('../../models/wsConnection');
const { docClient } = require('../../lib/dynamodb');
const {AsyncLocalStorage} = require('node:async_hooks');
const requestIdentity = new AsyncLocalStorage();
const {frame: errorFrame} = require('../../lib/interviewError');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ASYNC_QUEUE_URL = process.env.ASYNC_QUEUE_URL;
const WS_CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE;

// Finding 5: an unbounded transcript would be forwarded verbatim to the LLM and
// Polly, so cap it. STT output for a spoken answer is far below this.
const MAX_TRANSCRIPT_CHARS = 10000;

/**
 * Finding 5 (point 1): validate a turn_submit payload BEFORE any session state
 * is acquired. Returns an error string when the payload is unacceptable, or
 * null when it is safe to proceed. Previously the handler moved the session to
 * PROCESSING_RESPONSE first and validated afterwards, so a missing/malformed
 * transcript wedged the session in PROCESSING_RESPONSE with no work ever queued
 * and every later turn was rejected as TURN_IN_PROGRESS.
 */
function validateTurnSubmit(body) {
  const { textTranscript, isSilence } = body;
  if (isSilence !== undefined && typeof isSilence !== 'boolean') {
    return 'isSilence must be a boolean';
  }
  // A silence turn legitimately carries no transcript.
  if (isSilence === true) return null;
  if (typeof textTranscript !== 'string' || textTranscript.trim().length === 0) {
    return 'textTranscript is required when not marked as silence';
  }
  if (textTranscript.length > MAX_TRANSCRIPT_CHARS) {
    return `textTranscript exceeds ${MAX_TRANSCRIPT_CHARS} characters`;
  }
  return null;
}

async function sendError(connectionId, message, code = 400, dependencyFailure = false) {
  try {
    const isException = dependencyFailure || message instanceof Error;
    const category = code === 401 ? 'AUTH_EXPIRED' : code === 403 ? 'FORBIDDEN' : code === 404 ? 'SESSION_NOT_FOUND' :
      code === 409 ? 'STATE_CONFLICT' : code === 503 ? 'SERVICE_UNAVAILABLE' : 'INVALID_REQUEST';
    const retryable = [401,409,429,503,504].includes(code);
    await postToConnection(connectionId, errorFrame(isException ? message : null, requestIdentity.getStore() || {},
      isException ? null : [code,category,retryable,message]));
  } catch (e) {
    diagnostics.error('Failed to send error:', e instanceof Error ? e : new Error('dependency_failure'));
  }
}

async function updateConnectionHeartbeat(connectionId, userId) {
  if (!connectionId) return;
  try {
    await require('../../lib/dynamodb').fencedSend(new UpdateCommand({
      TableName: WS_CONNECTIONS_TABLE,
      Key: { connectionId },
      // R-10: refresh only the liveness heartbeat. The authorization ttl is
      // bound to the verified token at $connect and must NOT be extended by a
      // message-path write, or a socket would outlive the credential that
      // authenticated it.
      UpdateExpression: 'SET lastHeartbeat = :heartbeat',
      ConditionExpression: 'attribute_exists(connectionId) AND isActive = :active',
      ExpressionAttributeValues: {
        ':heartbeat': Date.now(),
        ':active': 'true'
      }
    }),userId);
  } catch (err) {
    diagnostics.warn(`Failed to refresh heartbeat for ${connectionId}:`, err);
  }
}

/**
 * Resolve the voice mode + engine for a turn. The client may pass voiceMode on
 * each message (so a user can switch mid-session); otherwise fall back to what
 * the session was created with. 'premium' -> generative, 'cost_saver' -> neural.
 */
function resolveVoiceMode(session, body) {
  const requested = body?.voiceMode;
  const stored = session?.itemData?.voiceMode || session?.voiceMode;
  const voiceMode = (requested === 'premium' || requested === 'cost_saver')
    ? requested
    : (stored === 'premium' ? 'premium' : 'cost_saver');
  const engine = voiceMode === 'premium' ? 'generative' : 'neural';
  return { voiceMode, engine };
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
    diagnostics.warn(`Unable to resolve last AI turn index for session ${sessionId}:`, err);
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
      return await sendError(connectionId, 'Interview not found', 404);
    }

    // BUG-2 FIX: Validate session ownership
    if (session.userId !== userId) {
      return await sendError(connectionId, 'Forbidden: Session does not belong to this user', 403);
    }

    const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
    if ([INTERVIEW_STATES.TERMINATED,INTERVIEW_STATES.ERROR,INTERVIEW_STATES.GENERATING_FEEDBACK].includes(session.currentState)) {
      return postToConnection(connectionId,errorFrame(null,requestIdentity.getStore(),[409,'SESSION_TERMINAL',false,'This interview has stopped.']));
    }
    const finalVoiceId = allowedVoices.includes(voiceId) ? voiceId : (session.voiceId || 'Tiffany');

    // VOICE MODE: the session was created with a voiceMode ('premium' unlocks
    // generative voices, 'cost_saver' stays on neural). The engine follows from
    // the mode; lib/polly.js still validates the (voice, engine) pair and
    // enforces the generative opt-in.
    const { voiceMode: finalVoiceMode, engine: finalEngine } = resolveVoiceMode(session, body);
    await require('../../lib/deletionJob').assertNotDeleting(userId);
    await updateSessionState(sessionId,session.currentState,session.currentState,{connectionId});

    // BUG-4 FIX: Use UpdateCommand with attribute_not_exists to prevent overwrite race
    try {
      await require('../../lib/dynamodb').fencedSend(new UpdateCommand({
        TableName: WS_CONNECTIONS_TABLE,
        Key: { connectionId },
        // R-10: the authorization ttl is bound to the verified token at
        // $connect; a session-level message (init/reconnect) must not silently
        // extend it, or a socket would outlive its credential.
        UpdateExpression: 'SET sessionId = :sessionId, userId = :userId, isActive = :active, connectedAt = :connectedAt',
        ConditionExpression: 'attribute_exists(connectionId) AND isActive = :active',
        ExpressionAttributeValues: {
          ':sessionId': sessionId,
          ':userId': userId,
          ':active': 'true',
          ':connectedAt': Date.now()
        }
      }),userId);
    } catch (updateErr) {
      if (updateErr.name === 'ConditionalCheckFailedException') {
        diagnostics.warn(`Connection ${connectionId} mapping failed: condition not met`);
        return await sendError(connectionId, 'Session initialization failed: connection state conflict', 409);
      } else {
        throw updateErr;
      }
    }

    await require('../../lib/deadline').sendBounded(sqsClient,new SendMessageCommand({
      QueueUrl: ASYNC_QUEUE_URL,
      MessageBody: JSON.stringify({
        connectionId,
        sessionId,
        userId,   // BE-BUG #17 FIX: pass userId so asyncWorker can call handlers with ownership context
        action: 'session_init',
        requestId: body.requestId,
        voiceId: finalVoiceId,
        engine: finalEngine,
        voiceMode: finalVoiceMode
      })
    }));

    diagnostics.log(`[session_init] Queued for ${sessionId} with voice ${finalVoiceId} (${finalVoiceMode})`);

  } catch (err) {
    diagnostics.error('session_init error:', err instanceof Error ? err : new Error('dependency_failure'));
    await sendError(connectionId, err, 503, true);
  }
}

async function handleTurnSubmit(connectionId, body, userId) {
  const { sessionId, textTranscript, isSilence, currentConceptId, voiceId, engine, clientTurnId } = body;

  if (!sessionId) {
    return await sendError(connectionId, 'sessionId is required for turn_submit');
  }

  // Finding 5 (point 1): validate BEFORE any session state is acquired. A bad
  // payload must never move the session into PROCESSING_RESPONSE — that used to
  // wedge the session with no work queued and reject every later turn.
  const validationError = validateTurnSubmit(body);
  if (validationError) {
    return await sendError(connectionId, validationError, 400);
  }

  try {
    const session = await getSessionById(sessionId);

    if (!session) return await sendError(connectionId, 'Interview not found', 404);

    // Ownership is checked before any state is reported back, so probing an
    // arbitrary sessionId cannot reveal whether it exists or what state it is
    // in. (The check used to sit below the state branches.)
    if (session.userId !== userId) {
      return await sendError(connectionId, 'Forbidden: Session does not belong to this user', 403);
    }

    if ([INTERVIEW_STATES.TERMINATED,INTERVIEW_STATES.ERROR].includes(session.currentState)) {
      return await postToConnection(connectionId,errorFrame(null,requestIdentity.getStore(),[409,'SESSION_TERMINAL',false,'This interview has stopped. Your draft is retained.']));
    }

    await require('../../lib/deletionJob').assertNotDeleting(userId);
    if (clientTurnId && (typeof clientTurnId !== 'string' || clientTurnId.length > 200)) return sendError(connectionId,'Invalid turn ID',400);
    const receipts = require('../../lib/turnReceipt');
    const receipt = clientTurnId ? await receipts.get(sessionId,clientTurnId) : null;
    if (receipt) {
      if(receipt.fingerprint !== receipts.fingerprint(body)) return postToConnection(connectionId,errorFrame(null,requestIdentity.getStore(),[409,'TURN_ID_CONFLICT',false,'A turn ID cannot be reused for a different answer']));
      if(session.turnCount <= receipt.job.expectedTurnCount) await require('../../lib/deadline').sendBounded(sqsClient,new SendMessageCommand({QueueUrl:ASYNC_QUEUE_URL,MessageBody:JSON.stringify(receipt.job)}));
      await postToConnection(connectionId,{type:'turn_ack',payload:{sessionId,clientTurnId,duplicate:true}});
      if(session.lastTurnPayload?.clientTurnId===clientTurnId) await postToConnection(connectionId,{type:'turn_complete',payload:session.lastTurnPayload});
      return;
    }
    if (body.turnId && session.lastTurnPayload?.turnId && body.turnId !== session.lastTurnPayload.turnId) {
      return postToConnection(connectionId,errorFrame(null,requestIdentity.getStore(),[409,'STALE_QUESTION',false,'This answer belongs to an earlier question.']));
    }
    if (clientTurnId && session.clientTurnId === clientTurnId) {
      if (session.pendingAnswer && (session.pendingAnswer.textTranscript !== textTranscript || !!session.pendingAnswer.isSilence !== !!isSilence)) {
        return postToConnection(connectionId,errorFrame(null,requestIdentity.getStore(),[409,'TURN_ID_CONFLICT',false,'A turn ID cannot be reused for a different answer']));
      }
      await postToConnection(connectionId, { type: 'turn_ack', payload: { sessionId, clientTurnId, duplicate: true } });
      return;
    }

    if (session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
      await postToConnection(connectionId, { 
        type: 'termination', 
        payload: { sessionId, reason: session.terminationReason || 'GENERATING_FEEDBACK', feedbackExpected: true }
      });
      return;
    }
    if (session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE || session.currentState === INTERVIEW_STATES.AI_SPEAKING) {
      return await sendError(connectionId, 'TURN_IN_PROGRESS', 409);
    }

    const job = {connectionId,sessionId,userId,clientTurnId,jobId:clientTurnId,
      requestId:body.requestId,turnId:body.turnId,
      body:{textTranscript,isSilence,currentConceptId,...(body.audioExpected === true ? {audioExpected:true} : {})},action:'turn_submit',
      voiceId:voiceId||session.voiceId, ...resolveVoiceMode(session,body),expectedTurnCount:session.turnCount||0};
    // BUG-3 FIX: Make state update atomic - only update if currently USER_RESPONDING
    try {
      await updateSessionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.USER_RESPONDING, {
        ...(session.version !== undefined ? { expectedVersion: session.version } : {}),
        ...(clientTurnId ? { clientTurnId, jobId: clientTurnId, pendingAnswer: { textTranscript, isSilence: !!isSilence, currentConceptId } } : {}),
        connectionId, pendingJob:job, jobAttemptCount:0,
        ...(clientTurnId ? {transactionItems:[receipts.put(sessionId,clientTurnId,body,job,userId)]} : {})
      });
    } catch (stateErr) {
      if (stateErr.name === 'ConditionalCheckFailedException') {
        return await sendError(connectionId, 'Session state changed; turn submission cancelled', 409);
      }
      throw stateErr;
    }

    const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
    const finalVoiceId = allowedVoices.includes(voiceId) ? voiceId : (session.voiceId || 'Tiffany');

    // COST-FIX / VOICE MODE: see session_init note above.
    const { voiceMode: finalVoiceMode, engine: finalEngine } = resolveVoiceMode(session, body);

    diagnostics.log(`[turn_submit] Session ${sessionId} | Voice: ${finalVoiceId} | Engine: ${finalEngine} (${finalVoiceMode})`);

    // Finding 5 (point 2): if the enqueue fails the session is stranded in
    // PROCESSING_RESPONSE forever (every later turn rejected as
    // TURN_IN_PROGRESS). Roll the claim back to USER_RESPONDING so the client
    // can retry. The rollback is conditional on PROCESSING_RESPONSE so it can
    // never clobber a state a racing worker has already advanced.
    try {
      await require('../../lib/deadline').sendBounded(sqsClient,new SendMessageCommand({
        QueueUrl: ASYNC_QUEUE_URL,
        MessageBody: JSON.stringify({
          connectionId,
          sessionId,
          userId,
          clientTurnId,
          requestId: body.requestId,
          turnId: body.turnId,
          jobId: clientTurnId,
          body: { textTranscript, isSilence, currentConceptId },
          action: 'turn_submit',
          voiceId: finalVoiceId,
          engine: finalEngine,
          voiceMode: finalVoiceMode,
          expectedTurnCount: session.turnCount || 0
        })
      }));
    } catch (enqueueErr) {
      diagnostics.error('turn_submit enqueue failed; rolling back session state:', enqueueErr instanceof Error ? enqueueErr : new Error('dependency_failure'));
      return await sendError(connectionId, 'Could not queue your response, please try again', 503);
    }

    await postToConnection(connectionId, { type: 'turn_ack', payload: { sessionId, clientTurnId, accepted: true } });

  } catch (err) {
    diagnostics.error('turn_submit error:', err instanceof Error ? err : new Error('dependency_failure'));
    await sendError(connectionId, err, 503, true);
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
      return await sendError(connectionId, 'Session not found', 404);
    }

    // SECURITY: reconnect replays the session's current question back to the
    // caller. Without this check any connected user could reconnect to an
    // arbitrary sessionId and read another candidate's interview.
    if (session.userId !== userId) {
      return await sendError(connectionId, 'Forbidden: Session does not belong to this user', 403);
    }

    await require('../../lib/deletionJob').assertNotDeleting(userId);
    // REST may have created the session before the first socket connected or
    // before session_init was delivered. Reconnect must enqueue the opener;
    // fabricating a question here leaves INITIALIZING unable to accept answers.
    // The worker's conditional lease makes duplicate init deliveries safe.
    if (body.audioOnly === true) {
      let audioUrl = null;
      try { audioUrl = await require('../../lib/questionAudio').refreshQuestionAudio(session,body.turnId); }
      catch (_) { /* bounded failure retains the visible question */ }
      await postToConnection(connectionId,{type:'question_audio',payload:{sessionId,turnId:body.turnId,audioUrl,audioUnavailable:!audioUrl}});
      return;
    }
    if (session.currentState === INTERVIEW_STATES.ERROR) {
      await postToConnection(connectionId,errorFrame(null,requestIdentity.getStore(),[409,'RECOVERY_EXHAUSTED',false,'Interview recovery stopped on the server. Please end the interview.']));
      return;
    }
    if (session.currentState === INTERVIEW_STATES.INITIALIZING) {
      return await handleSessionInit(connectionId, {sessionId}, userId);
    }
    // Update connection mapping
    await updateSessionState(sessionId, session.currentState, session.currentState, { connectionId });
    try {
      await require('../../lib/dynamodb').fencedSend(new UpdateCommand({
        TableName: WS_CONNECTIONS_TABLE,
        Key: { connectionId },
        // R-10: the authorization ttl is bound to the verified token at
        // $connect; a session-level message (init/reconnect) must not silently
        // extend it, or a socket would outlive its credential.
        UpdateExpression: 'SET sessionId = :sessionId, userId = :userId, isActive = :active, connectedAt = :connectedAt',
        ConditionExpression: 'attribute_exists(connectionId) AND isActive = :active',
        ExpressionAttributeValues: {
          ':sessionId': sessionId,
          ':userId': userId,
          ':active': 'true',
          ':connectedAt': Date.now()
        }
      }),userId);
    } catch (updateErr) {
      if (updateErr.name === 'ConditionalCheckFailedException') {
        diagnostics.warn(`Connection ${connectionId} reconnection failed: condition not met`);
        return await sendError(connectionId, 'Session reconnection failed: connection state conflict', 409);
      } else {
        throw updateErr;
      }
    }

    if (session.currentState === INTERVIEW_STATES.TERMINATED || session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
      await postToConnection(connectionId, {
        type: 'termination',
        payload: { sessionId, reason: session.terminationReason || session.currentState, feedbackExpected: session.feedbackExpected ?? !session.discarded }
      });
      return;
    }

    // Finding 5 (point 3): recover a genuinely stuck lease, but never fabricate
    // a turn_complete for a turn that is still legitimately in flight.
    const staleThreshold = 30000;
    // updatedAt is stored as an ISO string; `Date.now() - <ISO string>` is NaN,
    // so the old numeric comparison treated every session as fresh and never
    // recovered a wedged one. Parse defensively for either shape.
    const updatedAtMs = typeof session.updatedAt === 'number'
      ? session.updatedAt
      : Date.parse(session.updatedAt);
    const isStale = !session.leaseOwner && Number.isFinite(updatedAtMs)
      && Date.now() - updatedAtMs > staleThreshold;
    const inFlightStates = [
      INTERVIEW_STATES.AI_SPEAKING,
      INTERVIEW_STATES.PROCESSING_RESPONSE,
      INTERVIEW_STATES.LOADING_CONTEXT
    ];
    const lastAiTurnIndex = await getLastAiTurnIndex(sessionId, session.turnCount || 0);

    if (isStale && inFlightStates.includes(session.currentState)) {
      // Genuinely wedged for >30s. Reclaim it for the user, but conditionally on
      // the exact state we observed so a worker that is still alive and about to
      // commit wins the race instead of being overwritten.
      try {
        await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, session.currentState);
      } catch (stateErr) {
        if (stateErr.name === 'ConditionalCheckFailedException') {
          // A worker committed while we were reconnecting — the turn was not
          // stuck after all. Acknowledge without replaying so we do not
          // fabricate a duplicate answer.
          await postToConnection(connectionId, {
            type: 'reconnect_ack',
            payload: { sessionId, clientTurnId: session.clientTurnId, state: session.currentState, timestamp: Date.now() }
          });
          return;
        }
        throw stateErr;
      }
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

    if (inFlightStates.includes(session.currentState)) {
      // A valid, still-running turn. Do NOT replay USER_RESPONDING — that told
      // the client the AI had finished and duplicated the answer. Just
      // acknowledge; the in-flight text_stream / turn_complete arrives on this
      // same socket.
      await postToConnection(connectionId, {
        type: 'reconnect_ack',
        payload: { sessionId, clientTurnId: session.clientTurnId, state: session.currentState, timestamp: Date.now() }
      });
      return;
    }

    if (session.lastTurnPayload && session.currentState === INTERVIEW_STATES.USER_RESPONDING) {
      await postToConnection(connectionId,{type:'turn_complete',payload:session.lastTurnPayload});
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
          turnId: session.lastTurnPayload?.turnId || session.jobId,
          expectsAnswer: session.expectsAnswer,
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
    diagnostics.error('session_reconnect error:', err instanceof Error ? err : new Error('dependency_failure'));
    await sendError(connectionId, err, 503, true);
  }
}

async function handleTerminateSession(connectionId, body, userId) {
  const { sessionId, reason = 'USER_INITIATED' } = body;

  if (!sessionId) {
    return await sendError(connectionId, 'sessionId required');
  }

  try {
    const terminateSession = require('../interview/terminateSession');
    const terminationResult = await terminateSession.handler({
      requestContext: {
        authorizer: {
          uid: userId
        }
      },
      body: JSON.stringify({ sessionId, reason })
    });
    if (terminationResult?.statusCode >= 400) throw new Error('Session termination was not acknowledged');

    try {
      await postToConnection(connectionId, {
        type: 'termination',
        payload: { sessionId, reason, ...JSON.parse(terminationResult?.body || '{}'), timestamp: Date.now() }
      });
    } catch (wsErr) {
      if (wsErr.message === 'StaleConnectionError') {
        diagnostics.warn(`Stale connection during termination for ${sessionId}`);
      } else {
        throw wsErr;
      }
    }

  } catch (err) {
    diagnostics.error('terminate_session error:', err instanceof Error ? err : new Error('dependency_failure'));
    await sendError(connectionId, err, 503, true);
  }
}

exports.handler = async (event) => {
  const connectionId = event.requestContext?.connectionId;
  const routeKey = event.requestContext?.routeKey;

  // A malformed frame used to throw here, outside the try below, surfacing as
  // an unhandled Lambda error with no reply to the client.
  let body;
  try {
    body = JSON.parse(event.body || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        (body.payload !== undefined && (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)))) {
      throw new Error('Invalid frame');
    }
  } catch (parseErr) {
    diagnostics.warn(`Malformed WebSocket frame from ${connectionId}:`, parseErr.name);
    await sendError(connectionId, 'Malformed message payload', 400);
    return { statusCode: 400, body: 'Bad Request' };
  }

  // SECURITY: the WebSocket $default route has no API Gateway authorizer, so
  // event.requestContext.authorizer is always undefined here. The previous
  // fallback to body.userId meant the identity used for every ownership check
  // was supplied by the client — any connected user could drive, read or
  // terminate another user's session by sending their uid. The only trusted
  // identity is the one $connect wrote to the connections table after
  // verifying the Firebase ID token; resolve it from there and never from the
  // message body.
  let connection;
  try { connection = await getConnection(connectionId); }
  catch (error) {
    await sendError(connectionId,error);
    return {statusCode:503,body:'Service Unavailable'};
  }
  const userId = connection?.userId;

  if (!userId || connection.isActive !== 'true') {
    diagnostics.error(`WebSocket message from unregistered/inactive connection ${connectionId}`);
    await sendError(connectionId, 'Unauthorized: connection is not authenticated', 401);
    return { statusCode: 401, body: 'Unauthorized' };
  }
  // Old sockets must reconnect with a verified token before stateful messages.
  if (connection.emailVerified !== true) {
    await sendError(connectionId, 'Verify your email and reconnect', 403);
    return { statusCode: 403, body: 'EMAIL_VERIFICATION_REQUIRED' };
  }

  // Enforce the connection's ttl at message time. The DynamoDB TTL sweeper only
  // deletes expired rows on a best-effort, minutes-to-hours delay, so a socket
  // whose auth window has lapsed can still send frames with the row present.
  // The window is bound at $connect to the verified token's own expiry (R-10),
  // so rejecting here stops a long-lived socket from outliving its credential
  // (finding 16) — the client reconnects, which re-verifies the token.
  const nowSec = Math.floor(Date.now() / 1000);
  if (connection.ttl && connection.ttl < nowSec) {
    diagnostics.warn(`WebSocket message from expired connection ${connectionId} (ttl elapsed)`);
    await sendError(connectionId, 'Session expired, please reconnect', 401);
    return { statusCode: 401, body: 'Unauthorized' };
  }

  diagnostics.log(`Received WS frame from connection ${connectionId}`);

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
        await updateConnectionHeartbeat(connectionId,userId);
        await postToConnection(connectionId, { type: 'pong', timestamp: Date.now() });
        break;
      default:
        diagnostics.warn('Unknown WebSocket message type');
        await sendError(connectionId, 'Unknown message type', 400);
    }
  } catch (error) {
    diagnostics.error('WebSocket handler error:', error instanceof Error ? error : new Error('dependency_failure'));
    await sendError(connectionId, error, 503, true);
  }

  return { statusCode: 200 };
};

const route=exports.handler;
exports.handler=(event,context)=>{
  let body;try {body=JSON.parse(event.body||'{}');} catch (_) {body={};}
  const payload=body?.payload||body||{};
  const identity={sessionId:payload.sessionId,clientTurnId:payload.clientTurnId,turnId:payload.turnId,
    requestId:payload.requestId,operation:body?.type||event.requestContext?.routeKey};
  return requestIdentity.run(identity,()=>require('../../lib/deadline').withDeadline(context,()=>route(event),{maxMs:25000}));
};
