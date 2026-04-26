const { getSession, INTERVIEW_STATES, updateSessionState } = require('../../models/session');
const { postToConnection } = require('../../lib/websocket');
const { SPEAKERS, saveTranscript, getTranscriptBySession } = require('../../models/transcript');
const { pushStateUpdate } = require('./stateUpdateHandler');

// Handlers
const generateQuestion = require('../interview/generateQuestion');
const processUserInput = require('../interview/processUserInput');
const terminateSession = require('../interview/terminateSession');
const { synthesizeToBase64Chunks } = require('../../lib/polly');
const { invokeModelStream, buildInterviewPrompt, buildTutorPrompt, buildWebsiteTeachPrompt } = require('../../lib/bedrock');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { transitionState } = require('../interview/controlTurnFlow');
const { associateSession } = require('../../models/wsConnection');
const { fetchAndCleanContent } = require('../../lib/scraper');
const { getConceptsBySession } = require('../../models/conceptState');


// Supported engine voices
const SUPPORTED_VOICES = [
    'Tiffany', 'Matthew', 'Gregory', 'Ivy', 'Joanna', 'Kendra', 
    'Kimberly', 'Salli', 'Joey', 'Justin', 'Kevin', 'Patrick', 
    'Stephen', 'Ruth'
];

/**
 * AWS Lambda Handler for WebSocket $default route.
 * Dispatches messages based on the 'type' field in the body.
 */
exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const body = JSON.parse(event.body || '{}');
    const type = body.type;

    console.info(`Received WS message [${type}] from connection ${connectionId}`);

    try {
        switch (type) {
            case 'session_init':
                return await handleSessionInit(connectionId, body);
            case 'text_transcript':
                return await handleTextTranscript(connectionId, body);
            case 'silence_detected':
                return await handleSilenceDetected(connectionId, body);
            case 'session_reconnect':
                return await handleSessionReconnect(connectionId, body);
            case 'terminate_session':
                return await handleTerminateSession(connectionId, body);
            case 'ping':
                await postToConnection(connectionId, { type: 'pong' });
                return { statusCode: 200 };
            default:

                console.warn(`Unhandled message type: ${type}`);
                return { statusCode: 200, body: 'Type not handled' };
        }
    } catch (error) {
        console.error('WebSocket message processing failed:', error);
        
        // FIX 4: RECOVER: Don't leave session stuck in PROCESSING_RESPONSE
        try {
            const { sessionId } = body.payload || {};
            if (sessionId) {
                const session = await getSession(sessionId);
                if (session && session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE) {
                    await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, null, {});
                    await pushStateUpdate(connectionId, sessionId, 
                        INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.USER_RESPONDING,
                        session.turnCount, "Please try again.");
                }
            }
        } catch (recoveryError) {
            console.error('State recovery failed:', recoveryError);
        }

        await postToConnection(connectionId, {
            type: 'error',
            payload: { message: 'Failed to process message: ' + error.message }
        });
        return { statusCode: 500 };
    }
};

/**
 * Orchestrates a streaming AI response:

 * 1. Streams text from Bedrock
 * 2. Buffers sentences
 * 3. Starts synthesis (Polly) as soon as a sentence is complete
 * 4. Pushes results to WebSocket connection
 */
async function streamAIResponse(connectionId, sessionId, session, moduleType, prompt) {
    const pollyVoice = SUPPORTED_VOICES.includes(session.voiceId) ? session.voiceId : 'Tiffany';
    let fullText = "";
    let sentenceBuffer = "";
    let globalAudioChunkIndex = 0;

    // Buffer for sending partial text updates to avoid flooding WS
    let textRefreshTimer = null;
    const sendPartialText = async (text) => {
        await postToConnection(connectionId, {
            type: 'session_text_stream',
            payload: { text }
        });
    };

    let lastProcessPromise = Promise.resolve();

    const processSentence = async (sentence) => {
        let cleanSentence = sentence;
        try {
            const parsed = JSON.parse(sentence);
            if (parsed.question) cleanSentence = parsed.question;
            else if (parsed.response) cleanSentence = parsed.response;
        } catch (e) {
            // Fallback to regex for non-JSON responses
            cleanSentence = sentence
                .replace(/^\s*\{\s*"(question|response)"\s*:\s*"/, '')
                .replace(/"\s*\}\s*$/, '')
                .replace(/\\"/g, '"')
                .trim();
        }

        if (!cleanSentence) return;

        lastProcessPromise = lastProcessPromise.then(async () => {
            try {
                const engine = session.itemData?.engine || 'generative';
                for await (const audioChunk of synthesizeToBase64Chunks(cleanSentence, { VoiceId: pollyVoice, Engine: engine })) {
                    await postToConnection(connectionId, {
                        type: 'tts_audio_chunk',
                        payload: {
                            chunkIndex: globalAudioChunkIndex++,
                            audioData: audioChunk.audioData,
                            isLast: false
                        }
                    });
                }
            } catch (err) {
                console.error('Sentence processing failed:', err);
                // Notify frontend that audio synthesis failed for this sentence
                await postToConnection(connectionId, {
                    type: 'error',
                    payload: {
                        message: 'Audio synthesis failed: ' + err.message,
                        code: 'TTS_ERROR'
                    }
                });
                // Re-throw so the outer streamAIResponse catch can handle it
                throw err;
            }
        });
        return lastProcessPromise;
    };

    const voiceName = session.voiceId || 'Tiffany';
    const intros = {
        'RESUME': `Hello! I'm ${voiceName}. I've analyzed your resume, and I'm ready to start your technical interview. Let's begin.`,
        'WEBSITE': `Hi there! I'm ${voiceName}, your mentor. I've reviewed the website content you provided, and I'm excited to help you learn. Here's my first question.`,
        'HR': `Hello! I'm ${voiceName} from the recruiting team. I'll be conducting your behavioral interview today. Let's get started.`,
        'INTRO': `Hello! I'm ${voiceName}, your AI interviewer. Let's work on perfecting your self-introduction and elevator pitch. Ready when you are!`,
    };

    try {
        console.info(`[Stream] Starting Bedrock invocation for module: ${moduleType}`);
        
        // Notify client that AI is preparing to speak
        await postToConnection(connectionId, {
            type: 'session_text_stream',
            payload: { text: "", status: "thinking" }
        });

        // LATENCY HIDING: If this is the start of the session, send an immediate intro
        // while Bedrock is generating the first question.
        if (session.turnCount === 0) {
            const introText = intros[moduleType] || `Hello! I'm ${voiceName}, your AI interviewer. Let's begin our session.`;
            
            // FIX 2: Add intro to fullText so frontend sees it, but NOT to sentenceBuffer
            // to prevent processing it again during the Bedrock stream.
            fullText += introText + " ";

            console.debug(`[Stream] Sending instant intro to hide latency.`);
            await processSentence(introText);
            sentenceBuffer = ""; // Ensure clean buffer for stream tokens
        }

        await invokeModelStream(undefined, prompt, async (token) => {
            fullText += token;
            sentenceBuffer += token;

            // Only split on full sentence boundaries to avoid choppy speech
            const isFullBoundary = /[.!?](\s|$)/.test(sentenceBuffer) && sentenceBuffer.trim().length >= 20;

            if (isFullBoundary) {
                const sentenceToProcess = sentenceBuffer;
                sentenceBuffer = ""; 
                console.debug(`[Stream] Sentence boundary detected, processing: "${sentenceToProcess.substring(0, 30)}..."`);
                await processSentence(sentenceToProcess);
            }

            if (!textRefreshTimer) {
                textRefreshTimer = setTimeout(() => {
                    postToConnection(connectionId, {
                        type: 'session_text_stream',
                        payload: { text: fullText }
                    });
                    textRefreshTimer = null;
                }, 200);
            }
        });

        console.info(`[Stream] Bedrock stream finished. Total text length: ${fullText.length}`);

        if (sentenceBuffer.trim()) {
            console.debug(`[Stream] Processing final fragment: "${sentenceBuffer.substring(0, 30)}..."`);
            await processSentence(sentenceBuffer);
        }

        console.info(`[Stream] Awaiting final background synthesis...`);
        await lastProcessPromise;

        // Send the final question text (not a state update to avoid duplicate transitions)
        // Bug 11: Save AI question to transcript for conversation history
        // FIX 3: Only save the actual question, not the system-generated intro
        const introText = intros[moduleType];
        const transcriptText = (session.turnCount === 0 && introText)
            ? fullText.replace(introText, "").trim() || fullText
            : fullText;

        await saveTranscript(sessionId, session.turnCount, SPEAKERS.AI, transcriptText);

        await postToConnection(connectionId, {
            type: 'question_text_update',
            payload: {
                sessionId,
                turnIndex: session.turnCount,
                questionText: fullText,
                currentConceptId: session.currentConceptId,
                timestamp: Date.now()
            }
        });

        // Persist the final question text to DynamoDB so reconnects can restore it
        await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, null, {
            questionText: fullText,
        });

        // FINAL SIGNAL: Send an empty chunk with isLast:true to signal completion.
        // This MUST reach the TTS service so it fires onPlaybackComplete.
        await postToConnection(connectionId, {
            type: 'tts_audio_chunk',
            payload: {
                audioData: '',
                isLast: true
            }
        });

        await postToConnection(connectionId, {
            type: 'ai_speaking_complete',
            payload: { sessionId, turnIndex: session.turnCount }
        });


        console.info(`[Stream] Sequential processing complete.`);

        return fullText;
    } catch (error) {
        console.error('Streaming Response Failed:', error);
        
        // Bug 7: Transition to ERROR state so session isn't stuck in AI_SPEAKING
        try {
            await updateSessionState(sessionId, INTERVIEW_STATES.ERROR, null, {
                terminationReason: 'STREAMING_ERROR: ' + error.message
            });
        } catch (stateError) {
            console.error('Failed to transition to ERROR state:', stateError);
        }

        // Notify the client of the failure so they don't stay in a hanging state
        await postToConnection(connectionId, {
            type: 'error',
            payload: { 
                message: 'AI response failed. Please try again.',
                code: 'STREAMING_ERROR'
            }
        });

        throw error;
    }
}


async function handleSessionInit(connectionId, body) {
    const { sessionId, moduleType } = body.payload || {};
    if (!sessionId) throw new Error('Missing sessionId');

    const session = await getSession(sessionId);
    if (!session) throw new Error('Session not found');

    if (moduleType && session.moduleType !== moduleType) {
        await postToConnection(connectionId, {
            type: 'error',
            payload: { message: 'MODULE_MISMATCH', code: 'MODULE_MISMATCH' }
        });
        throw new Error('MODULE_MISMATCH');
    }

    // Associate this connection with the session for reconnect support
    await associateSession(connectionId, sessionId);

    const userId = session.userId;
    const transcripts = await getTranscriptBySession(sessionId);
    const history = transcripts.map(t => ({
        role: t.speaker === 'USER' ? 'user' : 'assistant',
        content: [{ text: t.text }]
    }));

    // Build Prompt
    let prompt = [];
    if (session.moduleType === 'WEBSITE') {
        // Bug 4: Scrape actual content and use buildWebsiteTeachPrompt
        const websiteUrl = session.itemData?.websiteUrl;
        let content = 'No content available.';
        try {
            const scraped = await fetchAndCleanContent(websiteUrl);
            content = scraped.content;
        } catch (e) {
            console.warn('[SessionInit] Failed to scrape website content:', e.message);
        }
        const concepts = await getConceptsBySession(sessionId);
        const targetConcept = concepts.length > 0 ? concepts[0].conceptId : 'General Overview';
        
        // FIX 6: Save currentConceptId on WEBSITE init
        await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, null, { 
            currentConceptId: targetConcept 
        });

        prompt = buildWebsiteTeachPrompt(targetConcept, content, history, false);
    } else {
        let context = "Professional Background";
        if (session.moduleType === 'RESUME') {
            let resumeId = session.itemData?.resumeId;
            if (!resumeId) {
                const user = await getUserById(userId);
                resumeId = user.activeResumeId;
            }
            const resume = await getResumeById(resumeId);
            context = resume?.parsedData || context;
        }
        prompt = buildInterviewPrompt(context, history, 0, session.moduleType);
    }

    // FIX Bug 7+D: Use transitionState for validated transition (INITIALIZING → AI_SPEAKING)
    await transitionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, {
        turnCount: session.turnCount || 0
    });

    // Push state update to transition UI
    await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.INITIALIZING, INTERVIEW_STATES.AI_SPEAKING, 0, "...");

    // Stream the response
    await streamAIResponse(connectionId, sessionId, session, session.moduleType, prompt);

    // Transition to USER_RESPONDING so the user can speak
    await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
    await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.USER_RESPONDING, 0, "Your turn to respond.");

    return { statusCode: 200 };
}

async function handleTextTranscript(connectionId, body) {
  const { sessionId, text } = body.payload || {};

  if (!sessionId || !text) throw new Error('Missing sessionId or text');

  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');

  // BUG 9: Guard against zombie/terminated sessions
  if (session.currentState === INTERVIEW_STATES.TERMINATED || session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
    await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
    return { statusCode: 200 };
  }

  // FIX 3: Defense: Reject if AI is still speaking (race condition protection)
  if (session.currentState === INTERVIEW_STATES.AI_SPEAKING) {
    await postToConnection(connectionId, {
      type: 'error',
      payload: { 
        message: 'Please wait for the AI to finish speaking.',
        code: 'AI_STILL_SPEAKING'
      }
    });
    return { statusCode: 200 };
  }

  // 2. Call business logic (NO state transition here)
  const processRes = await processUserInput.handler({ 
    body: JSON.stringify({ 
      sessionId, 
      textTranscript: text,
      currentConceptId: body.payload?.currentConceptId // Bug 9: Pass through for WEBSITE mode
    }) 
  });

  // 3. Handle failure gracefully
  if (processRes.statusCode !== 200) {
    const errorBody = JSON.parse(processRes.body);
    // Push error to client
    await postToConnection(connectionId, { 
      type: 'error', 
      payload: { message: errorBody.error || 'Processing failed' } 
    });
    return { statusCode: 200 }; // Handled
  }

  // 4. Extract data safely
  const processBody = JSON.parse(processRes.body);
  const data = processBody.data || processBody; 
  const nextAIResponse = data.nextAIResponse;
  const onlyQuestion = data.onlyQuestion || nextAIResponse;

  // Refresh session from DB to get the most up-to-date state (turnCount, scores)
  const updatedSession = await getSession(sessionId);

  // 4. Handle pre-generated responses (silence retry, deadlock recovery)
  if (data.silenceRetries || data.message?.includes('Deadlock') || data.message?.includes('Silence')) {
    await streamPreGeneratedResponse(connectionId, sessionId, updatedSession, nextAIResponse);
    
    await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
    await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.USER_RESPONDING, updatedSession.turnCount, "Your turn to respond.");
    
    return { statusCode: 200 };
  }

  // Only require nextAIResponse for WEBSITE/INTRO modes where processUserInput generates it
  if (session.moduleType !== 'RESUME' && session.moduleType !== 'HR' && !nextAIResponse) {
    throw new Error('No AI response generated');
  }

  // Bug 2: For WEBSITE and INTRO, if nextAIResponse was pre-generated, use it directly
  if (nextAIResponse && (session.moduleType === 'WEBSITE' || session.moduleType === 'INTRO')) {
    await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.AI_SPEAKING, updatedSession.turnCount, "AI is speaking.");
    await streamPreGeneratedResponse(connectionId, sessionId, updatedSession, nextAIResponse);
    
    await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
    await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.USER_RESPONDING, updatedSession.turnCount, "Your turn to respond.");
    
    return { statusCode: 200 };
  }

  // 5. Build prompt for streaming
  // We need to rebuild history AFTER processUserInput saved the new transcript
  const transcripts = await getTranscriptBySession(sessionId);
  const history = transcripts.map(t => ({
    role: t.speaker === 'USER' ? 'user' : 'assistant',
    content: [{ text: t.text }]
  }));

  let prompt = [];
  if (session.moduleType === 'WEBSITE') {
    // Bug 4: Scrape actual content and use buildWebsiteTeachPrompt
    const websiteUrl = session.itemData?.websiteUrl;
    let content = 'No content available.';
    try {
        const scraped = await fetchAndCleanContent(websiteUrl);
        content = scraped.content;
    } catch (e) {
        console.warn('[TextTranscript] Failed to scrape website content:', e.message);
    }
    const concepts = await getConceptsBySession(sessionId);
    const targetConcept = (concepts.length > 0 ? concepts[0].conceptId : 'General Overview');
    prompt = buildWebsiteTeachPrompt(targetConcept, content, history, true);
  } else {
    let context = "Professional Background";
    if (session.moduleType === 'RESUME') {
      let resumeId = session.itemData?.resumeId;
      if (!resumeId) {
        const user = await getUserById(session.userId);
        resumeId = user.activeResumeId;
      }
      const resume = await getResumeById(resumeId);
      context = resume?.parsedData || context;
    }
    prompt = buildInterviewPrompt(context, history, session.turnCount + 1, session.moduleType);
  }

  // 6. Push state and stream response
  await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.AI_SPEAKING, updatedSession.turnCount, "AI is generating next question.");

  await streamAIResponse(connectionId, sessionId, updatedSession, session.moduleType, prompt);

  await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
  await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.USER_RESPONDING, updatedSession.turnCount, "Your turn to respond.");

  return { statusCode: 200 };
}

/**
 * Helper to stream pre-generated text (silence retries, etc) via TTS without Bedrock
 */
async function streamPreGeneratedResponse(connectionId, sessionId, session, text) {
    const pollyVoice = SUPPORTED_VOICES.includes(session.voiceId) ? session.voiceId : 'Tiffany';
    const engine = session.itemData?.engine || 'generative';
    
    // Bug 4: Save AI response to transcripts for conversation history
    await saveTranscript(sessionId, session.turnCount, SPEAKERS.AI, text);
    
    // Stream text
    await postToConnection(connectionId, {
      type: 'session_text_stream',
      payload: { text }
    });
    
    // Synthesize TTS
    let chunkIndex = 0;
    for await (const audioChunk of synthesizeToBase64Chunks(text, { VoiceId: pollyVoice, Engine: engine })) {
      await postToConnection(connectionId, {
        type: 'tts_audio_chunk',
        payload: { chunkIndex: chunkIndex++, audioData: audioChunk.audioData, isLast: false }
      });
    }
    
    // Final signals
    await postToConnection(connectionId, {
      type: 'tts_audio_chunk',
      payload: { audioData: '', isLast: true }
    });
    
    await postToConnection(connectionId, {
      type: 'ai_speaking_complete',
      payload: { sessionId, turnIndex: session.turnCount }
    });
    
    // Send finalized question text (no state transition to avoid duplicates)
    await postToConnection(connectionId, {
      type: 'question_text_update',
      payload: {
        sessionId,
        turnIndex: session.turnCount,
        questionText: text,
        currentConceptId: session.currentConceptId,
        timestamp: Date.now()
      }
    });
}


/**
 * Handles silence_detected events from the frontend.
 * Routes through processUserInput with isSilence flag for retry/termination logic.
 */
async function handleSilenceDetected(connectionId, body) {
    const { sessionId } = body.payload || {};
    if (!sessionId) throw new Error('Missing sessionId');

    const processRes = await processUserInput.handler({
        body: JSON.stringify({ sessionId, isSilence: true })
    });

    if (processRes.statusCode !== 200) {
        const errorBody = JSON.parse(processRes.body);
        await postToConnection(connectionId, {
            type: 'error',
            payload: { message: errorBody.error || 'Silence processing failed' }
        });
        return { statusCode: 200 };
    }

    const processBody = JSON.parse(processRes.body);
    const data = processBody.data;

    // Check for termination (3rd silence strike)
    if (data.state === 'TERMINATED' || data.reason === 'SILENCE_TIMEOUT') {
        await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
        return { statusCode: 200 };
    }

    const updatedSession = await getSession(sessionId);

    if (data.silenceRetries || data.message?.includes('Silence')) {
        await streamPreGeneratedResponse(connectionId, sessionId, updatedSession, data.nextAIResponse);
        await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
        await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.USER_RESPONDING, updatedSession.turnCount, "Your turn.");
    }

    return { statusCode: 200 };
}


/**
 * Handles session_reconnect after a WebSocket connection drops and re-establishes.
 * Re-associates the new connection with the existing session and pushes current state.
 */
async function handleSessionReconnect(connectionId, body) {
    const { sessionId } = body.payload || {};
    if (!sessionId) throw new Error('Missing sessionId');

    const session = await getSession(sessionId);
    if (!session) {
        await postToConnection(connectionId, {
            type: 'error',
            payload: { message: 'Session not found for reconnect', code: 'SESSION_NOT_FOUND' }
        });
        return { statusCode: 200 };
    }

    // Re-associate this new connection ID with the session
    await associateSession(connectionId, sessionId);

    console.info(`[Reconnect] Connection ${connectionId} re-associated with session ${sessionId} (state: ${session.currentState})`);

    // Push current state so the frontend can sync
    if (session.currentState === INTERVIEW_STATES.TERMINATED || session.currentState === INTERVIEW_STATES.GENERATING_FEEDBACK) {
        await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
    } else {
        // Bug 8: If reconnecting during AI_SPEAKING, the frontend is stuck because
        // no TTS audio will play and onPlaybackComplete will never fire.
        // Send an empty isLast chunk to unblock the TTS service.
        if (session.currentState === INTERVIEW_STATES.AI_SPEAKING) {
            // Send whatever question text we have
            if (session.questionText) {
                await postToConnection(connectionId, {
                    type: 'question_text_update',
                    payload: {
                        sessionId,
                        turnIndex: session.turnCount,
                        questionText: session.questionText
                    }
                });
            }
            // Send isLast to unblock TTS → fires onPlaybackComplete → enables mic
            await postToConnection(connectionId, {
                type: 'tts_audio_chunk',
                payload: { audioData: '', isLast: true }
            });
            await postToConnection(connectionId, {
                type: 'ai_speaking_complete',
                payload: { sessionId, turnIndex: session.turnCount }
            });
            // Transition to USER_RESPONDING
            try {
                await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
            } catch (e) {
                console.warn('[Reconnect] State transition failed:', e.message);
            }
            await pushStateUpdate(
                connectionId, sessionId,
                INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.USER_RESPONDING,
                session.turnCount,
                null
            );
        } else {
            // Normal reconnect — send question text separately to avoid transcript duplication
            if (session.questionText) {
                await postToConnection(connectionId, {
                    type: 'question_text_update',
                    payload: {
                        sessionId,
                        turnIndex: session.turnCount,
                        questionText: session.questionText
                    }
                });
            }
            // Push state WITHOUT questionText to avoid transcript duplication
            await pushStateUpdate(
                connectionId, sessionId,
                session.currentState, session.currentState,
                session.turnCount,
                null
            );
        }
    }

    return { statusCode: 200 };
}


async function handleTerminateSession(connectionId, body) {
    const { sessionId } = body.payload || {};
    await terminateSession.handler({
        body: JSON.stringify({ sessionId, reason: 'USER_INITIATED' })
    });
    
    await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
    return { statusCode: 200 };
}
