const diagnostics=require('../../lib/logger').safeConsole;
const { handler: generateQuestion, cleanAIResponse } = require('./generateQuestion');
const { synthesizeSpeech } = require('../../lib/polly');
const { getSession, getSessionById, updateSessionState, INTERVIEW_STATES, INTRO_STAGES } = require('../../models/session');
const { saveTranscript, getContextWindow, compareTranscripts } = require('../../models/transcript');
const processUserInput = require('./processUserInput');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { postToConnection } = require('../../lib/websocket');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { readGeneratedTurn, closingText } = require('../../lib/turnOutput');
const { randomUUID } = require('node:crypto');

function leaseFence(session) {
  return session.leaseOwner ? {
    expectedLeaseOwner: session.leaseOwner,
    expectedLeaseVersion: session.leaseVersion,
    expectedJobId: session.jobId,
    expectedTurnCount: session.turnCount || 0
  } : {};
}

async function deliver(sessionId, fallback, event) {
  const current = await getSessionById(sessionId);
  if (!current) return false;
  return postToConnection(current.connectionId || fallback, event);
}

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const AUDIO_BUCKET = process.env.AUDIO_BUCKET;

// BE-BUG #6 FIX: Max context messages for truncation (was dead code, now applied)
const MAX_CONTEXT_MESSAGES = 20;

// INTERVIEW FLOW: interviews wrap up naturally instead of running forever.
// turnCount counts completed AI turns; at the cap the AI delivers a closing
// statement and the session terminates with INTERVIEW_COMPLETE.
const MAX_INTERVIEW_TURNS = parseInt(process.env.MAX_INTERVIEW_TURNS || '8', 10);

// 3-STRIKE SYSTEM: the LLM prefixes [OFFTOPIC] when the candidate's answer is
// completely unrelated; each strike carries a spoken warning, and the third
// ends the session.
const MAX_OFFTOPIC_STRIKES = 3;

// Maximum characters of AI speech per turn (keeps spoken pacing natural).
const MAX_AI_TEXT_LENGTH = 300;

// I-04: how long a worker's claim on a turn (LOADING_CONTEXT) is honored before
// a redelivered SQS message may reclaim it. Set above the worker's own timeout
// (60s) so a still-running worker is never preempted, but bounded so a crashed
// worker's turn is recoverable rather than lost forever.
const WORKER_LEASE_MS = parseInt(process.env.WORKER_LEASE_MS || '75000', 10);

// API Gateway frame limit is 32 KiB. Measure the complete encoded event.
const MAX_FRAME_BYTES = 32 * 1024;

/**
 * PERF-FIX #4: Truncate at a sentence boundary instead of a hard substring cut.
 * The old `substring(0, 300) + '.'` chopped mid-word, producing broken speech
 * from Polly. We now cut at the last sentence terminator, falling back to the
 * last word boundary.
 */
function truncateAtSentenceBoundary(text, maxLength = MAX_AI_TEXT_LENGTH) {
  if (!text || text.length <= maxLength) return text;

  const slice = text.substring(0, maxLength);
  const lastTerminator = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?')
  );

  // Only cut at the terminator if it leaves a meaningful amount of speech.
  if (lastTerminator > maxLength * 0.4) {
    return slice.substring(0, lastTerminator + 1).trim();
  }

  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.substring(0, lastSpace) : slice).trim() + '.';
}

// Split into sentences, keeping their terminators.
function splitSentences(text) {
  const parts = String(text).match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [String(text).trim()];
}

/**
 * I-05: shorten AI speech WITHOUT dropping the question. The prior
 * `truncateAtSentenceBoundary` kept the START of the text, so a long
 * acknowledgment followed by the actual question ("<praise>. <question>?")
 * discarded the question entirely — leaving the user with nothing to answer.
 *
 * An interview turn is "<acknowledgment> <question>", the question being the
 * final sentence(s). This keeps the trailing question sentence intact and
 * prepends as much of the preceding acknowledgment as fits the budget. The
 * question is never removed; if it alone exceeds the budget it is trimmed at a
 * word boundary but preserved.
 */
function shortenPreservingQuestion(text, maxLength = MAX_AI_TEXT_LENGTH) {
  if (!text || text.length <= maxLength) return text;

  const sentences = splitSentences(text);
  if (sentences.length <= 1) return text;

  // The trailing block to protect: extend back from the end through any
  // sentences that together form the question (usually just the last one).
  const kept = [sentences[sentences.length - 1]];
  let len = kept[0].length;
  for (let i = sentences.length - 2; i >= 0; i--) {
    const s = sentences[i];
    if (len + s.length + 1 > maxLength) break;
    kept.unshift(s);
    len += s.length + 1;
  }

  let result = kept.join(' ').trim();
  if (result.length > maxLength) {
    // The protected question alone exceeds the budget: trim at a word boundary
    // but keep it (an over-long question is still answerable; a missing one is not).
    // Keep the complete protected question even when it exceeds the preferred
    // speech length. The encoded delivery limit is enforced separately.
    result = kept[kept.length - 1];
  }
  return result;
}

async function uploadAudioToS3(sessionId, turnIndex, audioBuffer, userId, leaseIdentity) {
  if (!AUDIO_BUCKET) return null;

  const key = `audio/${sessionId}/${turnIndex}-${leaseIdentity||randomUUID()}.mp3`;
  try {
    await require('../../lib/deletionJob').assertNotDeleting(userId);
    await require('../../lib/deadline').sendBounded(s3Client,new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: key,
      Body: audioBuffer,
      ContentType: 'audio/mpeg'
    }));

    const getObjectCommand = new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: key
    });

    const url = await require('../../lib/deadline').bounded(()=>getSignedUrl(s3Client, getObjectCommand, { expiresIn: 3600 }),{label:'audioSigning'});
    return {url,key};
  } catch (err) {
    diagnostics.error('S3 upload failed:', err);
    return null;
  }
}

/**
 * PERF-FIX #5: Resolve interview context from the session snapshot when
 * available (written once at initializeSession) instead of re-reading the
 * resume and user items from DynamoDB on every single turn.
 */
async function resolveTurnContext(session, moduleType) {
  let resumeData = null;
  let userData = null;
  let websiteContent = null;
  let targetConcept = null;
  let jdSummary = null;

  if (moduleType === 'RESUME' || moduleType === 'JD') {
    if (session.itemData?.resumeSummary) {
      resumeData = session.itemData.resumeSummary; // pre-extracted at init
    } else if (session.itemData?.resumeId) {
      const resume = await getResumeById(session.itemData.resumeId);
      resumeData = resume?.parsedData || resume;
    }
  }
  if (moduleType === 'JD') {
    jdSummary = session.itemData?.jdSummary || null;
  }
  if (moduleType === 'WEBSITE') {
    websiteContent = session.itemData?.scrapedSummary || 'no website content';
    targetConcept = session.itemData?.targetConcept || 'the main topic';
  }

  if (session.itemData?.userName) {
    userData = {
      name: session.itemData.userName,
      currentRole: session.itemData.userCurrentRole || null
    };
  } else if (session.userId) {
    userData = await getUserById(session.userId);
  }

  return { resumeData, userData, websiteContent, targetConcept, jdSummary };
}

/**
 * I-01: deterministic SELF-INTRO stage planner. Given the session's persisted
 * `introStage`, decide (a) which prompt the model should produce this turn
 * (OPENER / COACHING / CLOSING) and (b) the stage to persist once the turn is
 * committed. The stage advances ONLY on an accepted user attempt, so silence
 * re-prompts (isReprompt) and retries never consume an attempt. A complete
 * intro requires two accepted attempts (first + revised) before CLOSING.
 *
 * Returns null for non-intro modules and for re-prompts (no stage change).
 */
function planIntroTurn(moduleType, session, isReprompt) {
  const isIntro = moduleType === 'INTRO' || moduleType === 'SELF_INTRO';
  if (!isIntro || isReprompt) return null;

  // Backfill for sessions created before I-01 (no persisted introStage): infer
  // from turnCount so an intro already in flight migrates cleanly. New sessions
  // always carry an explicit stage from the opener onward.
  let stage = session.introStage;
  if (!stage) {
    const tc = session.turnCount || 0;
    stage = tc <= 0
      ? null
      : (tc === 1 ? INTRO_STAGES.AWAITING_FIRST_ATTEMPT : INTRO_STAGES.AWAITING_REVISED_ATTEMPT);
  }

  if (!stage) {
    // Opener: ask "tell me about yourself", then await the first attempt.
    return { stageForPrompt: 'OPENER', nextIntroStage: INTRO_STAGES.AWAITING_FIRST_ATTEMPT, willClose: false };
  }
  if (stage === INTRO_STAGES.AWAITING_FIRST_ATTEMPT) {
    // First attempt accepted: coach, then await the revised attempt.
    return { stageForPrompt: 'COACHING', nextIntroStage: INTRO_STAGES.AWAITING_REVISED_ATTEMPT, willClose: false };
  }
  // AWAITING_REVISED_ATTEMPT (or beyond): the second attempt is in — deliver a
  // deterministic closing statement (never another question) and complete.
  return { stageForPrompt: 'CLOSING', nextIntroStage: INTRO_STAGES.COMPLETE, willClose: true };
}

function generateAtomicTurn(args) {
  return require('../../lib/deadline').withIdentity(args.session?.userId,()=>generateOwnedAtomicTurn(args));
}

async function generateOwnedAtomicTurn({
  connectionId,
  sessionId,
  session,
  moduleType,
  prompt,
  preGeneratedText,
  isReprompt = false,
  currentAnswer,
  currentAsr,
  currentAnswerTurnIndex,
  voiceId: requestedVoiceId,
  engine: requestedEngine,
  voiceMode: requestedVoiceMode
}) {
  const startTime = Date.now();

  try {
    const voiceId = require('../../lib/voicePolicy').preference(requestedVoiceId || session.voiceId).voiceId;
    const engine = requestedEngine || session.engine || 'neural';
    // VOICE MODE: 'premium' authorises generative synthesis for this session.
    const voiceMode = requestedVoiceMode || session.itemData?.voiceMode || session.voiceMode || 'cost_saver';
    const allowGenerative = voiceMode === 'premium';
    const ttsOptions = { allowGenerative };
    
    diagnostics.log(`[AtomicTurn] Session ${sessionId} | Turn ${session.turnCount || 0} | Voice: ${voiceId} | Engine: ${engine}`);

    // PERF-FIX #3: Query only the context window (recent turns + pinned opener)
    // instead of the full transcript history every turn.
    const contextTranscripts = await getContextWindow(sessionId, MAX_CONTEXT_MESSAGES);
    let conversationHistory = contextTranscripts.map(t => ({
      speaker: t.speaker,
      text: t.speaker === 'USER' ? (require('../../lib/feedbackAssessment').safeAnswer(t.text,t.asr).text || '[uncertain audio]') : t.text,
      turnIndex: t.turnIndex,
      seq: t.seq,
      createdAt: t.createdAt
    }));

    // I-08: the accepted answer is threaded in DIRECTLY from processUserInput so
    // the prompt always contains it EXACTLY ONCE, even when the transcripts GSI
    // has not yet caught up (eventual consistency). Only append it when the
    // context read did not already include this turn's USER answer, then re-order
    // with the shared comparator so it lands before the AI turn at the same
    // turnIndex. (No-op for openers/re-prompts, which pass no currentAnswer.)
    if (typeof currentAnswer === 'string' && currentAnswer.trim().length > 0) {
      const answerTurn = Number.isFinite(currentAnswerTurnIndex)
        ? currentAnswerTurnIndex
        : (session.turnCount || 0);
      conversationHistory = conversationHistory.filter(t => !(t.speaker === 'USER' && t.turnIndex === answerTurn));
      conversationHistory.push({ speaker: 'USER', text: require('../../lib/feedbackAssessment').safeAnswer(currentAnswer,currentAsr).text || '[uncertain audio]', turnIndex: answerTurn });
      conversationHistory = conversationHistory.slice().sort(compareTranscripts);
    }

    // PERF-FIX #6: Begin synthesizing the acknowledgment segment as soon as the
    // " || " delimiter arrives in the LLM stream, overlapping Polly latency
    // with the remaining generation instead of running them sequentially.
    let earlyTts = null;

    const currentTurn = session.turnCount || 0;
    const isFinalTurn = ['RESUME', 'HR', 'JD', 'WEBSITE'].includes(moduleType)
      && currentTurn >= MAX_INTERVIEW_TURNS - 1;

    // I-01: resolve the SELF-INTRO stage for this turn (null for other modules
    // and for re-prompts). stageForPrompt steers generateQuestion; nextIntroStage
    // is persisted on the commit; willClose ends the module after this turn.
    const introPlan = planIntroTurn(moduleType, session, isReprompt);

    let aiText = preGeneratedText;
    if (!aiText) {
      const { resumeData, userData, websiteContent, targetConcept, jdSummary } = await resolveTurnContext(session, moduleType);

      // Stream text to the frontend while generating
      let accumulatedText = "";
      const promptResult = await generateQuestion({
        body: {
          sessionId,
          moduleType,
          resumeData,
          userData,
          websiteContent,
          targetConcept,
          jdSummary,
          turnIndex: session.turnCount || 0,
          conversationHistory,
          voiceId,
          isFinalTurn,
          introStage: introPlan ? introPlan.stageForPrompt : undefined,
          onToken: async (token) => {
             accumulatedText += token;

             // Buffer tokens. Only validated, canonical text is delivered below,
             // as one ordered batch, before the final event.
          }
        }
      });
      
      let generationError;
      try { aiText = readGeneratedTurn(promptResult).question; }
      catch (err) { generationError = err; aiText = ''; }

      // RELIABILITY FIX: the LLM occasionally returns empty (throttle/timeout).
      // Retry once (non-streaming) before falling back to the apology line the
      // user complained about.
      if (!aiText || cleanAIResponse(aiText).length < 5) {
        diagnostics.warn('[AtomicTurn] Empty LLM output; retrying once');
        try {
          const retryResult = await generateQuestion({
            body: {
              sessionId, moduleType, resumeData, userData, websiteContent,
              targetConcept, jdSummary,
              turnIndex: session.turnCount || 0,
              conversationHistory, voiceId, isFinalTurn,
              introStage: introPlan ? introPlan.stageForPrompt : undefined
            }
          });
          aiText = readGeneratedTurn(retryResult).question;
          generationError = null;
        } catch (retryErr) {
          diagnostics.error('[AtomicTurn] Retry also failed:', retryErr.name);
          generationError = retryErr;
        }
      }
      if (generationError && !(introPlan?.willClose || isFinalTurn)) throw generationError;
    }

    // 3-STRIKE SYSTEM: detect and strip the off-topic marker before TTS.
    let offTopicFlagged = false;
    if (aiText && aiText.includes('[OFFTOPIC]')) {
      offTopicFlagged = true;
      aiText = aiText.replace(/\[OFFTOPIC\]/g, ' ').trim();
    }

    aiText = cleanAIResponse(aiText);
    const expectsAnswer = !(introPlan?.willClose || isFinalTurn);
    // Closing always comes from application code; even an apparently valid
    // model response can contain an invitation requiring another answer.
    if (!expectsAnswer) { aiText = closingText(!!introPlan); earlyTts = null; }
    if (!aiText || aiText.length < 5) throw new Error('Empty generated question; retry without advancing the stage.');

    const previousStrikes = session.offTopicStrikes || 0; // stored top-level by updateSessionState
    const strikes = offTopicFlagged ? previousStrikes + 1 : previousStrikes;
    const strikeLimitReached = offTopicFlagged && strikes >= MAX_OFFTOPIC_STRIKES;

    if (aiText.length > MAX_AI_TEXT_LENGTH) {
      diagnostics.warn(`[AtomicTurn] Shortening long response (${aiText.length} chars), preserving the question`);
      aiText = shortenPreservingQuestion(aiText, MAX_AI_TEXT_LENGTH);
    }

    // Synthesize speech. If the acknowledgment was already synthesized during
    // streaming and still prefixes the final text, only the remainder needs
    // synthesis now; the two MP3 segments are concatenated.
    let audioBase64 = '';
    if (offTopicFlagged) earlyTts = null; // marker was stripped; pre-synth no longer prefixes
    if (earlyTts && aiText.startsWith(earlyTts.text)) {
      const remainder = aiText.slice(earlyTts.text.length).trim();
      const [ackAudio, restAudio] = await Promise.all([
        earlyTts.promise,
        remainder.length > 0 ? synthesizeSpeech(remainder, voiceId, engine, ttsOptions) : Promise.resolve(null)
      ]);
      if (ackAudio?.audioBase64) {
        const buffers = [Buffer.from(ackAudio.audioBase64, 'base64')];
        if (restAudio?.audioBase64) buffers.push(Buffer.from(restAudio.audioBase64, 'base64'));
        audioBase64 = Buffer.concat(buffers).toString('base64');
        diagnostics.log(`[AtomicTurn] Used pre-synthesized acknowledgment audio (saved ~1 Polly round-trip)`);
      }
    }
    if (!audioBase64) {
      const audioResult = await synthesizeSpeech(aiText, voiceId, engine, ttsOptions);
      audioBase64 = audioResult.audioBase64 || '';
    }

    // PERF-FIX #7: S3-first audio delivery. Base64-over-WebSocket adds ~33%
    // overhead and risks the 128KB API Gateway frame limit; when a bucket is
    // configured we always upload and send a presigned URL (the client already
    // prefers audioUrl over audioData). Inline base64 remains as fallback.
    let audioData = '';
    let audioUrl = '';
    let audioKey;

    if (AUDIO_BUCKET && audioBase64) {
      const uploadedUrl = await uploadAudioToS3(sessionId, session.turnCount || 0, Buffer.from(audioBase64, 'base64'), session.userId);
      if (uploadedUrl) {
        audioUrl = uploadedUrl.url;
        audioKey = uploadedUrl.key;
      }
    }

    if (!audioUrl) {
      audioData = audioBase64;
    }

    const responsePayload = {
      type: 'turn_complete',
      payload: {
        sessionId,
        turnId: session.jobId || `${sessionId}#${session.turnCount || 0}`,
        clientTurnId: session.clientTurnId,
        sequence: 1,
        turnIndex: session.turnCount || 0,
        questionText: aiText,
        expectsAnswer,
        audioData,
        audioUrl,
        ...(audioKey ? {audioKey,audioRefreshable:true} : {}),
        currentConceptId: session.currentConceptId || null,
        state: INTERVIEW_STATES.AI_SPEAKING,
        timestamp: Date.now()
      }
    };

    if (Buffer.byteLength(JSON.stringify(responsePayload), 'utf8') > MAX_FRAME_BYTES) {
      responsePayload.payload.audioData = '';
      responsePayload.payload.audioFallback = 'TEXT_ONLY';
    }
    if (Buffer.byteLength(JSON.stringify(responsePayload), 'utf8') > MAX_FRAME_BYTES) throw new Error('Turn exceeds WebSocket frame limit');
    const transcript = require('../../models/transcript').buildTranscript(sessionId, session.turnCount || 0, 'AI', aiText, {eventId:session.jobId});
    try {
      await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.LOADING_CONTEXT, {
        ...leaseFence(session), guardUserId:session.userId,
        questionText:aiText, expectsAnswer, voiceId, engine, offTopicStrikes:strikes,
        lastTurnPayload: responsePayload.payload,
        ...(isReprompt ? {} : {incrementTurnCount:true}),
        ...(introPlan ? {introStage:introPlan.nextIntroStage} : {}),
        transactionItems:isReprompt ? [] : [{Put:{TableName:process.env.TRANSCRIPTS_TABLE || 'qlue-transcripts',Item:transcript}}]
      });
    } catch(error) {
      if(error.name==='ConditionalCheckFailedException') return {success:true,aborted:true};
      throw error;
    }
    await deliver(sessionId, connectionId, { type: 'text_stream', payload: {
      sessionId, turnId: responsePayload.payload.turnId, sequence: 0, fullText: aiText
    } });

    await deliver(sessionId, connectionId, responsePayload);
    diagnostics.log(`[AtomicTurn] Sent turn_complete in ${Date.now() - startTime}ms`);

    // BE-BUG #2 FIX: Re-check terminal state before transitioning to USER_RESPONDING
    const freshSession = await getSessionById(sessionId);
    if (freshSession && [INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.ERROR].includes(freshSession.currentState)) {
      diagnostics.warn(`[AtomicTurn] Session ${sessionId} moved to terminal state during processing; skipping USER_RESPONDING transition`);
      return { success: true, terminated: true };
    }

    // INTERVIEW FLOW: end the session after the closing statement (turn cap)
    // or when the off-topic strike limit is hit (the spoken warning was the
    // third strike). The user hears the final audio, then termination fires.
    // A silence re-prompt (isReprompt) is NOT a real turn and must never force
    // a close.
    if (!isReprompt && (isFinalTurn || strikeLimitReached)) {
       const reason = strikeLimitReached ? 'OFF_TOPIC_LIMIT' : 'INTERVIEW_COMPLETE';
       diagnostics.log(`[AtomicTurn] Ending session ${sessionId}: ${reason}`);
       const terminateSession = require('./terminateSession');
       const terminationResult = await terminateSession.handler({
         requestContext: { authorizer: { uid: session.userId } },
         body: JSON.stringify({ sessionId, reason })
       });
       if (terminationResult?.statusCode >= 400) throw new Error('Session termination was not acknowledged');
       await deliver(sessionId, connectionId, {
         type: 'termination',
         payload: { sessionId, reason, ...JSON.parse(terminationResult?.body || '{}'), timestamp: Date.now() }
       });
       return { success: true, terminated: true };
    }

    // I-01: Self-Intro (coach mode) ends ONLY after the CLOSING turn, i.e. once
    // two user attempts (first + revised) have been accepted and the closing
    // statement has been delivered. This is driven by the persisted introStage,
    // NOT by turnCount — so two silent pauses or a failed generation can no
    // longer "suddenly end" the practice mid-session.
    if (introPlan && introPlan.willClose) {
       diagnostics.log(`[AtomicTurn] Self-Intro session ${sessionId} complete after the closing statement.`);
       const terminateSession = require('./terminateSession');
       const terminationResult = await terminateSession.handler({
         requestContext: { authorizer: { uid: session.userId } },
         body: JSON.stringify({ sessionId, reason: 'INTRO_COMPLETE' })
       });
       if (terminationResult?.statusCode >= 400) throw new Error('Session termination was not acknowledged');
       await deliver(sessionId, connectionId, {
         type: 'termination',
         payload: { sessionId, reason: 'INTRO_COMPLETE', ...JSON.parse(terminationResult?.body || '{}'), timestamp: Date.now() }
       });
       return { success: true, terminated: true };
    }

    return { success: true };

  } catch (error) {
    diagnostics.error(`[AtomicTurn] Failed for ${sessionId}:`, error);
    
    try {
      await deliver(sessionId, connectionId, {
        type: 'turn_error',
        payload: {
          sessionId,
          ...require('../../lib/interviewError').frame(error,{sessionId,clientTurnId:session.clientTurnId,turnId:session.lastTurnPayload?.turnId}).payload,
          state: INTERVIEW_STATES.USER_RESPONDING,
          timestamp: Date.now()
        }
      });
    } catch (wsErr) {
      diagnostics.error('[AtomicTurn] Failed to send error:', wsErr);
    }
    
    throw error;
  }
}

exports.handler = async (event) => {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    let message;
    try {
      message = JSON.parse(record.body);
    } catch (e) {
      diagnostics.error('Failed to parse SQS message');
      continue;
    }

    const {
      connectionId,
      sessionId,
      body,
      voiceId,
      engine,
      voiceMode,
      action,
      expectedTurnCount,
      userId   // BE-BUG #17 FIX: userId now destructured from message
    } = message;

    diagnostics.log(`[AsyncWorker] Processing ${action} for session ${sessionId}`);
    const sentAt=Number(record.attributes?.SentTimestamp);
    if(Number.isFinite(sentAt)&&sentAt>0) diagnostics.info({metric:'queue_wait',durationMs:Math.max(0,Date.now()-sentAt)});

    let ownedSession;
    try {
      let session = await getSessionById(sessionId);
      if (!session) {
        diagnostics.error(`[AsyncWorker] Session ${sessionId} not found`);
        continue;
      }

      if ([INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.ERROR].includes(session.currentState)) {
        diagnostics.warn(`[AsyncWorker] Session ${sessionId} is in terminal state ${session.currentState}; skipping ${action}`);
        continue;
      }
      await require('../../lib/deletionJob').assertNotDeleting(session.userId);

      if (session.lastTurnPayload && session.currentState === INTERVIEW_STATES.USER_RESPONDING && (!session.lastTurnPayload.expectsAnswer || session.lastTurnPayload.clientTurnId === message.clientTurnId)) {
        await deliver(sessionId, connectionId, {type:'turn_complete',payload:session.lastTurnPayload});
        if (session.lastTurnPayload.expectsAnswer === false) {
          const terminationResult = await require('./terminateSession').handler({requestContext:{authorizer:{uid:session.userId}},body:JSON.stringify({sessionId,reason:'INTERVIEW_COMPLETE'})});
          if (terminationResult?.statusCode >= 400) throw new Error('Session termination failed');
          await deliver(sessionId,connectionId,{type:'termination',payload:{sessionId,reason:'INTERVIEW_COMPLETE',...JSON.parse(terminationResult?.body || '{}')}});
        }
        continue;
      }
      if (action === 'turn_submit' && session.turnCount > (expectedTurnCount || 0)) {
        diagnostics.warn(`[AsyncWorker] Turn ${expectedTurnCount} already processed (current: ${session.turnCount}), skipping`);
        continue;
      }

      if (action === 'session_init' && ![INTERVIEW_STATES.INITIALIZING, INTERVIEW_STATES.LOADING_CONTEXT].includes(session.currentState)) {
        diagnostics.warn(`[AsyncWorker] Session ${sessionId} not in INITIALIZING state (${session.currentState}), skipping`);
        continue;
      }

      // Finding 5 (point 5) + I-04: SQS is at-least-once, so the same turn can
      // be delivered to two workers, and a worker can crash mid-turn while
      // holding LOADING_CONTEXT. Atomically CLAIM the job by moving the session
      // into LOADING_CONTEXT from the state the producer left it in
      // (PROCESSING_RESPONSE for a turn, INITIALIZING for init) and stamp a
      // lease. A duplicate delivery of a FRESH turn loses the conditional claim
      // and is skipped. A turn already in LOADING_CONTEXT is only RECLAIMED once
      // its lease has expired (the previous worker crashed) — a live lease is
      // never stolen — and even a concurrent reclaim cannot double-commit
      // because generateAtomicTurn's commit is conditional on LOADING_CONTEXT.
      const nowMs = Date.now();
      const leaseExpiresAt = nowMs + WORKER_LEASE_MS;
      const leaseHeld = session.currentState === INTERVIEW_STATES.LOADING_CONTEXT
        && session.leaseExpiresAt && session.leaseExpiresAt > nowMs;
      if (leaseHeld) {
        diagnostics.warn(`[AsyncWorker] ${action} for ${sessionId} is still leased (expires ${session.leaseExpiresAt}); skipping duplicate delivery`);
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      const owner = randomUUID();
      const jobId = message.jobId || message.clientTurnId || `${sessionId}#${action}#${expectedTurnCount || 0}`;
      if(session.jobId === jobId && (session.jobAttemptCount||0) >= 3) {
        await updateSessionState(sessionId,INTERVIEW_STATES.ERROR,session.currentState,{
          expectedVersion:session.version,guardUserId:session.userId,terminationReason:'TURN_RECOVERY_EXHAUSTED'});
        await deliver(sessionId,connectionId,require('../../lib/interviewError').frame(null,{sessionId,clientTurnId:message.clientTurnId},[409,'RECOVERY_EXHAUSTED',false,'This turn could not complete. Your draft is retained. Please end the interview.']));
        continue;
      }
      const claim = {
        leaseOwner: owner,
        leaseVersion: (session.leaseVersion || 0) + 1,
        leaseExpiresAt, jobId, jobAttemptCount:session.jobId === jobId ? (session.jobAttemptCount||0)+1 : 1,
        ...(session.version !== undefined ? { expectedVersion: session.version } : {}),
        ...(session.currentState === INTERVIEW_STATES.LOADING_CONTEXT ? {
          reclaimBefore: nowMs,
          ...(session.leaseExpiresAt !== undefined ? { expectedLeaseExpiresAt: session.leaseExpiresAt } : {}),
          ...(session.leaseVersion !== undefined ? { expectedLeaseVersion: session.leaseVersion } : {})
        } : {})
      };
      try {
        if (action === 'turn_submit') {
          const fromState = session.currentState === INTERVIEW_STATES.LOADING_CONTEXT
            ? INTERVIEW_STATES.LOADING_CONTEXT       // reclaim an expired lease
            : INTERVIEW_STATES.PROCESSING_RESPONSE;  // fresh claim
          const claimed = await updateSessionState(sessionId, INTERVIEW_STATES.LOADING_CONTEXT, fromState, {
            expectedTurnCount: expectedTurnCount || 0,
            ...claim
          });
          session = { ...session, ...claim, ...claimed };
        } else if (action === 'session_init') {
          const fromState = session.currentState === INTERVIEW_STATES.LOADING_CONTEXT
            ? INTERVIEW_STATES.LOADING_CONTEXT
            : INTERVIEW_STATES.INITIALIZING;
          const claimed = await updateSessionState(sessionId, INTERVIEW_STATES.LOADING_CONTEXT, fromState, {
            ...claim
          });
          session = { ...session, ...claim, ...claimed };
        }
      } catch (claimErr) {
        if (claimErr.name === 'ConditionalCheckFailedException') {
          diagnostics.warn(`[AsyncWorker] ${action} for ${sessionId} already claimed/advanced; skipping duplicate delivery`);
          batchItemFailures.push({itemIdentifier:record.messageId});
          continue;
        }
        throw claimErr;
      }
      if (session.leaseOwner !== owner) { batchItemFailures.push({itemIdentifier:record.messageId}); continue; }
      ownedSession = session;
      const context = require('../../lib/deadline').current();
      if (context) context.userId = session.userId;

      if (action === 'session_init') {
        await generateAtomicTurn({
          connectionId,
          sessionId,
          session,
          moduleType: session.moduleType,
          voiceId,
          engine,
          voiceMode
        });
      }
      else if (action === 'turn_submit') {
        const processResult = await processUserInput.handler({
          [processUserInput.ASR_EVIDENCE]: body.asr,
          requestContext: {
            authorizer: {
              uid: userId
            }
          },
          body: JSON.stringify({
            sessionId,
            textTranscript: body.textTranscript,
            isSilence: body.isSilence,
            audioExpected: body.audioExpected === true,
            currentConceptId: body.currentConceptId
            ,clientTurnId: message.clientTurnId || body.clientTurnId,
            lease: leaseFence(session)
          })
        });

        const processBody = JSON.parse(processResult.body);

        // The status code was previously ignored, so a 403 (ownership) or 500
        // from processUserInput still fell through and generated a paid Bedrock
        // turn against a session that had rejected the input.
        if (processResult.statusCode && processResult.statusCode >= 400) {
          diagnostics.error(`[AsyncWorker] processUserInput rejected turn for ${sessionId}: ${processResult.statusCode}`);
          throw new Error(processBody.error || 'Failed to process user input');
        }

        // I-04: processUserInput reports the session moved on (terminated /
        // advanced) during processing. Do NOT generate a paid turn or deliver
        // anything over a session that is no longer the turn we claimed.
        if (processBody.aborted) {
          diagnostics.warn(`[AsyncWorker] Turn for ${sessionId} aborted: session advanced during processing; skipping generation.`);
          continue;
        }

        if (processBody.shouldTerminate) {
          const terminateSession = require('./terminateSession');
          const terminationResult = await terminateSession.handler({
            requestContext: {
              authorizer: {
                uid: userId
              }
            },
            body: JSON.stringify({ sessionId, reason: processBody.reason || 'SILENCE_TIMEOUT' })
          });
          if (terminationResult?.statusCode >= 400) throw new Error('Session termination was not acknowledged');
          const actualreason = processBody.reason || 'SILENCE_TIMEOUT';
          await deliver(sessionId, connectionId, {
            type: 'termination',
            payload: { sessionId, reason: actualreason, ...JSON.parse(terminationResult?.body || '{}'), timestamp: Date.now() }
          });
          continue;
        }

        // PERF-FIX #5: processUserInput now returns the updated session
        // attributes, so we avoid an extra DynamoDB read per turn. Fallback
        // re-fetch is retained for safety.
        let updatedSession = processBody.session;
        if (!updatedSession) {
          updatedSession = await getSessionById(sessionId);
        }
        if (!updatedSession) {
          diagnostics.error(`[AsyncWorker] Session ${sessionId} not found after processUserInput`);
          continue;
        }

        await generateAtomicTurn({
          connectionId,
          sessionId,
          session: { ...updatedSession, leaseOwner: session.leaseOwner, leaseVersion: session.leaseVersion, jobId: session.jobId },
          moduleType: updatedSession.moduleType,
          preGeneratedText: processBody.nextAIResponse,
          isReprompt: !!processBody.isReprompt,
          // I-08: hand the accepted answer to the prompt builder directly so it
          // is present even under transcripts-GSI lag (not re-read from the index).
          currentAnswer: processBody.acceptedAnswer,
          currentAsr: processBody.acceptedAsr,
          currentAnswerTurnIndex: processBody.acceptedTurnIndex,
          voiceId,
          engine,
          voiceMode
        });
      }

    } catch (error) {
      diagnostics.error(`[AsyncWorker] Error processing ${action} for ${sessionId}:`, error);

      // Finding 5 (point 6): recover WITHOUT reviving a finished interview. The
      // old handler unconditionally wrote USER_RESPONDING here, which
      // resurrected sessions a concurrent terminate had already moved to
      // TERMINATED / GENERATING_FEEDBACK — an interview could come back from the
      // dead. Re-read the session and: (a) if it is terminal, tell the client
      // the session ended and never re-open it; (b) if we still hold the
      // in-flight turn, hand control back to the user with a conditional write
      // so a late/duplicate worker cannot clobber a newer state.
      let recoveredState = null;
      let observedState = null;
      try {
        const current = await require('../../lib/deadline').finalize(()=>getSessionById(sessionId));
        observedState = current?.currentState || null;
        const terminalStates = [INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.ERROR];
        const inFlightStates = [INTERVIEW_STATES.LOADING_CONTEXT, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.AI_SPEAKING];

        if (current && terminalStates.includes(current.currentState)) {
          await deliver(sessionId, connectionId, {
            type: 'termination',
            payload: { sessionId, reason: current.terminationReason || current.currentState, feedbackExpected: current.feedbackExpected ?? !current.discarded, timestamp: Date.now() }
          });
          continue; // do NOT send a recoverable turn_error for a terminal session
        }

        if (current && ownedSession && current.leaseOwner === ownedSession.leaseOwner && current.leaseVersion === ownedSession.leaseVersion && inFlightStates.includes(current.currentState)) {
          try {
            await require('../../lib/deadline').finalize(()=>updateSessionState(sessionId, action === 'session_init' ? INTERVIEW_STATES.INITIALIZING : INTERVIEW_STATES.PROCESSING_RESPONSE, current.currentState, {
              ...leaseFence(ownedSession), leaseExpiresAt: 0
            }));
            recoveredState = INTERVIEW_STATES.USER_RESPONDING;
          } catch (stateErr) {
            if (stateErr.name !== 'ConditionalCheckFailedException') {
              diagnostics.error('[AsyncWorker] Failed to release session state after error:', stateErr);
            }
          }
        }
      } catch (recoveryErr) {
        diagnostics.error('[AsyncWorker] Session inspection during error recovery failed:', recoveryErr);
      }

      try {
        await deliver(sessionId, connectionId, {
          type: 'turn_error',
          payload: {
            sessionId,
          ...require('../../lib/interviewError').frame(error,{sessionId,clientTurnId:message.clientTurnId,turnId:message.turnId,requestId:message.requestId,turnIndex:message.expectedTurnCount}).payload,
            state: recoveredState || observedState || INTERVIEW_STATES.USER_RESPONDING,
            timestamp: Date.now()
          }
        });
      } catch (wsErr) {
        diagnostics.error('[AsyncWorker] Failed to send turn_error:', wsErr);
      }
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
};

module.exports.generateAtomicTurn = generateAtomicTurn;
module.exports.truncateAtSentenceBoundary = truncateAtSentenceBoundary;
module.exports.shortenPreservingQuestion = shortenPreservingQuestion;

const originalHandler = exports.handler;
exports.handler = (event,context) => require('../../lib/deadline').withDeadline(context, () => originalHandler(event,context), {maxMs:60000,userId:event.userId || event.requestContext?.authorizer?.uid});
