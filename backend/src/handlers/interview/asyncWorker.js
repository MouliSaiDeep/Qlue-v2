const { handler: generateQuestion, cleanAIResponse } = require('./generateQuestion');
const { synthesizeSpeech } = require('../../lib/polly');
const { getSession, getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { saveTranscript, getContextWindow } = require('../../models/transcript');
const processUserInput = require('./processUserInput');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { postToConnection } = require('../../lib/websocket');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const AUDIO_BUCKET = process.env.AUDIO_BUCKET;

// BE-BUG #6 FIX: Max context messages for truncation (was dead code, now applied)
const MAX_CONTEXT_MESSAGES = 20;

// Maximum characters of AI speech per turn (keeps spoken pacing natural).
const MAX_AI_TEXT_LENGTH = 300;

// API Gateway WebSocket frames cap at 128KB; keep inline audio well below it.
const MAX_INLINE_AUDIO_B64 = 60000;

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

async function uploadAudioToS3(sessionId, turnIndex, audioBuffer) {
  if (!AUDIO_BUCKET) return null;

  const key = `audio/${sessionId}/${turnIndex}.mp3`;
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: key,
      Body: audioBuffer,
      ContentType: 'audio/mpeg'
    }));

    const getObjectCommand = new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: key
    });

    return await getSignedUrl(s3Client, getObjectCommand, { expiresIn: 3600 });
  } catch (err) {
    console.error('S3 upload failed:', err);
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

  if (moduleType === 'RESUME') {
    if (session.itemData?.resumeSummary) {
      resumeData = session.itemData.resumeSummary; // pre-extracted at init
    } else if (session.itemData?.resumeId) {
      const resume = await getResumeById(session.itemData.resumeId);
      resumeData = resume?.parsedData || resume;
    }
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

  return { resumeData, userData, websiteContent, targetConcept };
}

async function generateAtomicTurn({ 
  connectionId, 
  sessionId, 
  session, 
  moduleType, 
  prompt,
  preGeneratedText,
  voiceId: requestedVoiceId,
  engine: requestedEngine
}) {
  const startTime = Date.now();
  
  try {
    const voiceId = requestedVoiceId || session.voiceId || 'Tiffany';
    const engine = requestedEngine || session.engine || 'generative';
    
    console.log(`[AtomicTurn] Session ${sessionId} | Turn ${session.turnCount || 0} | Voice: ${voiceId} | Engine: ${engine}`);

    // PERF-FIX #3: Query only the context window (recent turns + pinned opener)
    // instead of the full transcript history every turn.
    const contextTranscripts = await getContextWindow(sessionId, MAX_CONTEXT_MESSAGES);
    const conversationHistory = contextTranscripts.map(t => ({
      speaker: t.speaker,
      text: t.text,
      turnIndex: t.turnIndex
    }));

    // PERF-FIX #6: Begin synthesizing the acknowledgment segment as soon as the
    // " || " delimiter arrives in the LLM stream, overlapping Polly latency
    // with the remaining generation instead of running them sequentially.
    let earlyTts = null;

    let aiText = preGeneratedText;
    if (!aiText) {
      const { resumeData, userData, websiteContent, targetConcept } = await resolveTurnContext(session, moduleType);

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
          turnIndex: session.turnCount || 0,
          conversationHistory,
          voiceId,
          onToken: async (token) => {
             accumulatedText += token;

             if (!earlyTts && accumulatedText.includes('||')) {
               const ackText = cleanAIResponse(accumulatedText.split('||')[0]);
               if (ackText && ackText.length >= 5 && ackText.length <= MAX_AI_TEXT_LENGTH) {
                 earlyTts = {
                   text: ackText,
                   promise: synthesizeSpeech(ackText, voiceId, engine).catch(err => {
                     console.warn('[AtomicTurn] Early ack synthesis failed, will fall back to full synthesis:', err.message);
                     return null;
                   })
                 };
               }
             }

             // Send text_stream event to the frontend
             await postToConnection(connectionId, {
               type: 'text_stream',
               payload: {
                 sessionId,
                 text: token,
                 fullText: accumulatedText,
                 timestamp: Date.now()
               }
             }).catch(e => console.error('Failed to stream token to WS:', e));
          }
        }
      });
      
      const promptBody = JSON.parse(promptResult.body);
      aiText = promptBody.question;
    }

    aiText = cleanAIResponse(aiText);
    if (!aiText || aiText.length < 5) {
      aiText = "I'm sorry, could you tell me more about your experience?";
    }

    if (aiText.length > MAX_AI_TEXT_LENGTH) {
      console.warn(`[AtomicTurn] Truncating long response (${aiText.length} chars) at sentence boundary`);
      aiText = truncateAtSentenceBoundary(aiText, MAX_AI_TEXT_LENGTH);
    }

    // Synthesize speech. If the acknowledgment was already synthesized during
    // streaming and still prefixes the final text, only the remainder needs
    // synthesis now; the two MP3 segments are concatenated.
    let audioBase64 = '';
    if (earlyTts && aiText.startsWith(earlyTts.text)) {
      const remainder = aiText.slice(earlyTts.text.length).trim();
      const [ackAudio, restAudio] = await Promise.all([
        earlyTts.promise,
        remainder.length > 0 ? synthesizeSpeech(remainder, voiceId, engine) : Promise.resolve(null)
      ]);
      if (ackAudio?.audioBase64) {
        const buffers = [Buffer.from(ackAudio.audioBase64, 'base64')];
        if (restAudio?.audioBase64) buffers.push(Buffer.from(restAudio.audioBase64, 'base64'));
        audioBase64 = Buffer.concat(buffers).toString('base64');
        console.log(`[AtomicTurn] Used pre-synthesized acknowledgment audio (saved ~1 Polly round-trip)`);
      }
    }
    if (!audioBase64) {
      const audioResult = await synthesizeSpeech(aiText, voiceId, engine);
      audioBase64 = audioResult.audioBase64 || '';
    }

    // PERF-FIX #7: S3-first audio delivery. Base64-over-WebSocket adds ~33%
    // overhead and risks the 128KB API Gateway frame limit; when a bucket is
    // configured we always upload and send a presigned URL (the client already
    // prefers audioUrl over audioData). Inline base64 remains as fallback.
    let audioData = '';
    let audioUrl = '';

    if (AUDIO_BUCKET && audioBase64) {
      const uploadedUrl = await uploadAudioToS3(sessionId, session.turnCount || 0, Buffer.from(audioBase64, 'base64'));
      if (uploadedUrl) {
        audioUrl = uploadedUrl;
      }
    }

    if (!audioUrl) {
      if (audioBase64.length > MAX_INLINE_AUDIO_B64) {
        console.warn('[AtomicTurn] No S3 URL and audio exceeds inline limit; truncating text and re-synthesizing');
        aiText = truncateAtSentenceBoundary(aiText, 100);
        const shortAudio = await synthesizeSpeech(aiText, voiceId, engine);
        audioData = shortAudio.audioBase64 || '';
      } else {
        audioData = audioBase64;
      }
    }

    await saveTranscript(sessionId, session.turnCount || 0, 'AI', aiText);

    // BE-BUG #1 FIX: Transition to AI_SPEAKING BEFORE sending WS message (not USER_RESPONDING)
    // BE-BUG #21 FIX: DB state update happens before postToConnection
    await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, null, {
      questionText: aiText,
      voiceId: voiceId,
      engine: engine
    });

    const responsePayload = {
      type: 'turn_complete',
      payload: {
        sessionId,
        turnIndex: session.turnCount || 0,
        questionText: aiText,
        audioData,
        audioUrl,
        currentConceptId: session.currentConceptId || null,
        state: INTERVIEW_STATES.AI_SPEAKING,
        timestamp: Date.now()
      }
    };

    await postToConnection(connectionId, responsePayload);
    console.log(`[AtomicTurn] Sent turn_complete in ${Date.now() - startTime}ms`);

    // BE-BUG #2 FIX: Re-check terminal state before transitioning to USER_RESPONDING
    const freshSession = await getSessionById(sessionId);
    if (freshSession && [INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.ERROR].includes(freshSession.currentState)) {
      console.warn(`[AtomicTurn] Session ${sessionId} moved to terminal state during processing; skipping USER_RESPONDING transition`);
      return { success: true, terminated: true };
    }

    // Auto-terminate Self-Intro module after the AI provides its feedback (turn 1)
    if ((moduleType === 'INTRO' || moduleType === 'SELF_INTRO') && (session.turnCount || 0) >= 1) {
       console.log(`[AtomicTurn] Auto-terminating Self-Intro session ${sessionId} after providing feedback.`);
       const terminateSession = require('./terminateSession');
       await terminateSession.handler({
         requestContext: { authorizer: { uid: session.userId } },
         body: JSON.stringify({ sessionId, reason: 'INTRO_COMPLETE' })
       });
       await postToConnection(connectionId, {
         type: 'termination',
         payload: { sessionId, reason: 'INTRO_COMPLETE', timestamp: Date.now() }
       });
       return { success: true, terminated: true };
    }

    await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.AI_SPEAKING, {
      incrementTurnCount: true,
    });

    return { success: true };

  } catch (error) {
    console.error(`[AtomicTurn] Failed for ${sessionId}:`, error);
    
    try {
      await postToConnection(connectionId, {
        type: 'turn_error',
        payload: {
          sessionId,
          error: error.message,
          state: INTERVIEW_STATES.USER_RESPONDING,
          timestamp: Date.now()
        }
      });
    } catch (wsErr) {
      console.error('[AtomicTurn] Failed to send error:', wsErr);
    }
    
    throw error;
  }
}

exports.handler = async (event) => {
  for (const record of event.Records || []) {
    let message;
    try {
      message = JSON.parse(record.body);
    } catch (e) {
      console.error('Failed to parse SQS message:', record.body);
      continue;
    }

    const { 
      connectionId, 
      sessionId, 
      body, 
      voiceId, 
      engine,
      action,
      expectedTurnCount,
      userId   // BE-BUG #17 FIX: userId now destructured from message
    } = message;

    console.log(`[AsyncWorker] Processing ${action} for session ${sessionId}`);

    try {
      const session = await getSessionById(sessionId);
      if (!session) {
        console.error(`[AsyncWorker] Session ${sessionId} not found`);
        continue;
      }

      if ([INTERVIEW_STATES.TERMINATED, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.ERROR].includes(session.currentState)) {
        console.warn(`[AsyncWorker] Session ${sessionId} is in terminal state ${session.currentState}; skipping ${action}`);
        continue;
      }

      if (action === 'turn_submit' && session.turnCount > (expectedTurnCount || 0)) {
        console.warn(`[AsyncWorker] Turn ${expectedTurnCount} already processed (current: ${session.turnCount}), skipping`);
        continue;
      }

      if (action === 'session_init' && session.currentState !== INTERVIEW_STATES.INITIALIZING) {
        console.warn(`[AsyncWorker] Session ${sessionId} not in INITIALIZING state (${session.currentState}), skipping`);
        continue;
      }

      if (action === 'session_init') {
        await generateAtomicTurn({
          connectionId,
          sessionId,
          session,
          moduleType: session.moduleType,
          voiceId,
          engine
        });
      } 
      else if (action === 'turn_submit') {
        const processResult = await processUserInput.handler({
          requestContext: {
            authorizer: {
              uid: userId
            }
          },
          body: JSON.stringify({
            sessionId,
            textTranscript: body.textTranscript,
            isSilence: body.isSilence,
            currentConceptId: body.currentConceptId
          })
        });

        const processBody = JSON.parse(processResult.body);
        
        if (processBody.shouldTerminate) {
          const terminateSession = require('./terminateSession');
          await terminateSession.handler({
            requestContext: {
              authorizer: {
                uid: userId
              }
            },
            body: JSON.stringify({ sessionId, reason: processBody.reason || 'SILENCE_TIMEOUT' })
          });
          const actualreason = processBody.reason || 'SILENCE_TIMEOUT';
          await postToConnection(connectionId, {
            type: 'termination',
            payload: { sessionId, reason: actualreason, timestamp: Date.now() }
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
          console.error(`[AsyncWorker] Session ${sessionId} not found after processUserInput`);
          continue;
        }

        await generateAtomicTurn({
          connectionId,
          sessionId,
          session: updatedSession,
          moduleType: updatedSession.moduleType,
          preGeneratedText: processBody.nextAIResponse,
          voiceId,
          engine
        });
      }

    } catch (error) {
      console.error(`[AsyncWorker] Error processing ${action} for ${sessionId}:`, error);
      
      try {
        await postToConnection(connectionId, {
          type: 'turn_error',
          payload: {
            sessionId,
            error: error.message,
            timestamp: Date.now()
          }
        });
      } catch (wsErr) {
        console.error('[AsyncWorker] Failed to send turn_error:', wsErr);
      }
    }
  }
};

module.exports.generateAtomicTurn = generateAtomicTurn;
module.exports.truncateAtSentenceBoundary = truncateAtSentenceBoundary;
