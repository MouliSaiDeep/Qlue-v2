const { postToConnection } = require('../../lib/websocket');
const { getSession, INTERVIEW_STATES } = require('../../models/session');
const { pushStateUpdate } = require('./stateUpdateHandler');

// Handlers
const generateQuestion = require('../interview/generateQuestion');
const processUserInput = require('../interview/processUserInput');
const terminateSession = require('../interview/terminateSession');
const { synthesizeToBase64Chunks } = require('../../lib/polly');
const { invokeModelStream, buildResumeQuestionPrompt, buildHRQuestionPrompt, buildWebsiteTeachPrompt } = require('../../lib/bedrock');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { getTranscriptBySession } = require('../../models/transcript');


// Voice Mapping
const VOICE_MAP = {
    'Tiffany': 'Ruth',
    'Matthew': 'Matthew'
};

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
    const pollyVoice = VOICE_MAP[session.voiceId || 'Tiffany'] || 'Ruth';
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
        // CLEANUP: Strip common JSON markers if the model accidentally includes them
        let cleanSentence = sentence
            .replace(/\{"question":\s*"/g, '')
            .replace(/\{"response":\s*"/g, '')
            .replace(/"\}/g, '')
            .replace(/\\"/g, '"') // Unescape quotes
            .trim();

        if (!cleanSentence) return;
        
        // Use a sequential chain to ensure sentences are synthesized and sent IN ORDER
        lastProcessPromise = lastProcessPromise.then(async () => {
            try {
                for await (const audioChunk of synthesizeToBase64Chunks(cleanSentence, { VoiceId: pollyVoice })) {
                    await postToConnection(connectionId, {
                        type: 'audio_chunk',
                        chunkIndex: globalAudioChunkIndex++,
                        audioData: audioChunk.audioData,
                        isLast: false
                    });
                }
            } catch (err) {
                console.error('Sentence processing failed in background:', err);
                // We don't rethrow here to avoid breaking the entire stream chain, 
                // but the error is now caught and logged.
            }
        });
    };

    try {
        console.info(`[Stream] Starting Bedrock invocation for module: ${moduleType}`);
        
        // Notify client that AI is preparing to speak
        await postToConnection(connectionId, {
            type: 'session_text_stream',
            text: "", 
            status: "thinking"
        });

        // LATENCY HIDING: If this is the start of the session, send an immediate intro
        // while Bedrock is generating the first question.
        if (session.turnCount === 0) {
            const intros = {
                'RESUME': "Hello! <break time='300ms'/> I'm Tiffany. I've analyzed your resume, and I'm ready to start your technical interview. <break time='200ms'/> Let's begin.",
                'WEBSITE': "Hi there! <break time='300ms'/> I'm your mentor. I've reviewed the website content you provided, and I'm excited to help you learn. <break time='200ms'/> Here's my first question.",
                'HR': "Hello! <break time='300ms'/> I'm Tiffany from the recruiting team. I'll be conducting your behavioral interview today. <break time='200ms'/> Let's get started."
            };
            const introText = intros[moduleType] || "Hello! <break time='300ms'/> I'm Tiffany, your AI interviewer. Let's begin our session.";
            console.debug(`[Stream] Sending instant intro to hide latency.`);
            processSentence(introText);
        }

        await invokeModelStream(undefined, { messages: prompt }, async (token) => {
            fullText += token;
            sentenceBuffer += token;

            // ULTRA-LOW LATENCY: Aggressive boundary detection
            // We start synthesis as soon as we have a meaningful phrase (40+ chars with punctuation)
            // or a full sentence boundary.
            const isFullBoundary = /[.!?](\s|$)/.test(sentenceBuffer);
            const isPartialBoundary = sentenceBuffer.length > 40 && /[,;:](\s|$)/.test(sentenceBuffer);

            if (isFullBoundary || isPartialBoundary) {
                const sentenceToProcess = sentenceBuffer;
                sentenceBuffer = ""; 
                console.debug(`[Stream] Boundary detected, processing fragment: "${sentenceToProcess.substring(0, 30)}..."`);
                processSentence(sentenceToProcess);
            }

            if (!textRefreshTimer) {
                textRefreshTimer = setTimeout(() => {
                    postToConnection(connectionId, {
                        type: 'session_text_stream',
                        text: fullText
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
        
        // FINAL SIGNAL: Send an empty chunk with isLast:true to signal completion
        await postToConnection(connectionId, {
            type: 'audio_chunk',
            audioData: '',
            isLast: true
        });

        console.info(`[Stream] Sequential processing complete.`);

        // Final UI text sync
        await sendPartialText(fullText);

        return fullText;
    } catch (error) {
        console.error('Streaming Response Failed:', error);
        
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

    const userId = session.userId;
    const transcripts = await getTranscriptBySession(sessionId);
    const history = transcripts.map(t => ({
        role: t.speaker === 'USER' ? 'user' : 'assistant',
        content: t.text
    }));

    // Build Prompt
    let prompt = [];
    if (session.moduleType === 'RESUME') {
        let resumeId = session.itemData?.resumeId;
        if (!resumeId) {
            const user = await getUserById(userId);
            resumeId = user.activeResumeId;
        }
        const resume = await getResumeById(resumeId);
        prompt = buildResumeQuestionPrompt(resume?.parsedData, history, 0);
    } else if (session.moduleType === 'WEBSITE') {
        prompt = buildWebsiteTeachPrompt(session.itemData?.websiteUrl, "", history, false);
    } else {
        prompt = buildHRQuestionPrompt("Professional Background", history);
    }

    // Push state update to transition UI
    await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.INITIALIZING, INTERVIEW_STATES.AI_SPEAKING, 0, "...");

    // Stream the response
    await streamAIResponse(connectionId, sessionId, session, session.moduleType, prompt);

    return { statusCode: 200 };
}

async function handleTextTranscript(connectionId, body) {
    const { sessionId, text } = body.payload || {};

    if (!sessionId || !text) throw new Error('Missing sessionId or text');

    // 1. Process user input (non-streaming parts: scoring, etc)
    // We call the existing handler but we'll ignore its question generation part 
    // or we'll refactor it to just do scoring.
    // For now, let's just do it here to be fast.
    const session = await getSession(sessionId);
    const transcripts = await getTranscriptBySession(sessionId);
    const history = transcripts.map(t => ({
        role: t.speaker === 'USER' ? 'user' : 'assistant',
        content: t.text
    }));
    history.push({ role: 'user', content: text });

    // 2. Build Next Question Prompt
    let prompt = [];
    if (session.moduleType === 'RESUME') {
        let resumeId = session.itemData?.resumeId;
        if (!resumeId) {
            const user = await getUserById(session.userId);
            resumeId = user.activeResumeId;
        }
        const resume = await getResumeById(resumeId);
        prompt = buildResumeQuestionPrompt(resume?.parsedData, history, session.turnCount + 1);
    } else if (session.moduleType === 'WEBSITE') {
        prompt = buildWebsiteTeachPrompt("", "", history, true);
    } else {
        prompt = buildHRQuestionPrompt("Professional Background", history);
    }

    // 3. Stream the response
    await pushStateUpdate(connectionId, sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.AI_SPEAKING, session.turnCount + 1, "...");
    
    await streamAIResponse(connectionId, sessionId, session, session.moduleType, prompt);

    return { statusCode: 200 };
}


async function handleTerminateSession(connectionId, body) {
    const { sessionId } = body.payload || {};
    await terminateSession.handler({
        body: JSON.stringify({ sessionId, reason: 'USER_TERMINATED' })
    });
    
    await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
    return { statusCode: 200 };
}
