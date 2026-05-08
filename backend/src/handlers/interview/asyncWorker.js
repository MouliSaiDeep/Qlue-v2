const { handler: generateQuestion, cleanAIResponse } = require('./generateQuestion');
const { synthesizeSpeech } = require('../../lib/polly');
const { getSession, getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { saveTranscript, getTranscriptBySession } = require('../../models/transcript');
const processUserInput = require('./processUserInput');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { postToConnection } = require('../../lib/websocket');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const AUDIO_BUCKET = process.env.AUDIO_BUCKET;

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

    const transcripts = await getTranscriptBySession(sessionId);
    const conversationHistory = transcripts.map(t => ({
      speaker: t.speaker,
      text: t.text,
      turnIndex: t.turnIndex
    }));

    let aiText = preGeneratedText;
    if (!aiText) {
      let resumeData = null;
      let userData = null;
      let websiteContent = null;
      let targetConcept = null;

      if (moduleType === 'RESUME' && session.itemData?.resumeId) {
        const resume = await getResumeById(session.itemData.resumeId);
        resumeData = resume?.parsedData || resume;
      }
      if(moduleType==='WEBSITE'){
        websiteContent=session.itemData?.scrapedSummary|| "no website content"
        targetConcept = session.itemData?.targetConcept|| "the main topic";
      }
      if (session.userId) {
        userData = await getUserById(session.userId);
      }

      const promptResult = await generateQuestion({
        body: JSON.stringify({
          sessionId,
          moduleType,
          resumeData,
          userData,
          websiteContent,
          targetConcept,
          turnIndex: session.turnCount || 0,
          conversationHistory,
          voiceId
        })
      });
      
      const promptBody = JSON.parse(promptResult.body);
      aiText = promptBody.question;
    }

    aiText = cleanAIResponse(aiText);
    if (!aiText || aiText.length < 5) {
      aiText = "I'm sorry, could you tell me more about your experience?";
    }

    if (aiText.length > 300) {
      console.warn(`[AtomicTurn] Truncating long response (${aiText.length} chars)`);
      aiText = aiText.substring(0, 300) + '.';
    }

    const audioResult = await synthesizeSpeech(aiText, voiceId, engine);
    const audioBase64 = audioResult.audioBase64 || '';
    
    let audioData = '';
    let audioUrl = '';
    
    if (audioBase64.length > 60000) {
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const uploadedUrl = await uploadAudioToS3(sessionId, session.turnCount || 0, audioBuffer);
      if (uploadedUrl) {
        audioUrl = uploadedUrl;
        console.log(`[AtomicTurn] Audio uploaded to S3: ${audioUrl}`);
      } else {
        console.warn('[AtomicTurn] S3 upload failed, truncating text and using inline audio');
        aiText = aiText.substring(0, 100) + '.';
        const shortAudio = await synthesizeSpeech(aiText, voiceId, engine);
        audioData = shortAudio.audioBase64 || '';
        audioUrl = ''; // BUG-11 FIX: Explicitly clear audioUrl when using audioData fallback
      }
    } else {
      audioData = audioBase64;
    }

    await saveTranscript(sessionId, session.turnCount || 0, 'AI', aiText);

    const responsePayload = {
      type: 'turn_complete',
      payload: {
        sessionId,
        turnIndex: session.turnCount || 0,
        questionText: aiText,
        audioData,
        audioUrl,
        currentConceptId: session.currentConceptId || null,
        state: INTERVIEW_STATES.USER_RESPONDING,
        timestamp: Date.now()
      }
    };

    await postToConnection(connectionId, responsePayload);
    console.log(`[AtomicTurn] Sent turn_complete in ${Date.now() - startTime}ms`);

    await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, null, {
      questionText: aiText,
      incrementTurnCount: true, // BUG-10 FIX: Use atomic increment to prevent duplicate race conditions
      voiceId: voiceId,
      engine: engine
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

// 1. Add expectedTurnCount to the destructured message object
    const { 
      connectionId, 
      sessionId, 
      body, 
      voiceId, 
      engine,
      action,
      expectedTurnCount 
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

      // 2. Fix the condition to check expectedTurnCount instead of body.expectedTurnCount
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
              uid: message.userId
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
            // ADD requestContext HERE so the termination is authorized
            requestContext: {
              authorizer: {
                uid: message.userId
              }
            },
            body: JSON.stringify({ sessionId, reason: processBody.reason || 'SILENCE_TIMEOUT' })
          });
          const actualreason=processBody.reason || 'SILENCE_TIMEOUT'
          await postToConnection(connectionId, {
            type: 'termination',
            payload: { sessionId, reason: actualreason, timestamp: Date.now() }
          });
          continue;
        }

        // Re-fetch session to get updated turnCount after processUserInput
        const updatedSession = await getSessionById(sessionId);
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
