const { getSession, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { postToConnection, StaleConnectionError } = require('../../lib/websocket');
const { SPEAKERS, saveTranscript, getTranscriptBySession } = require('../../models/transcript');
const { transitionState } = require('./controlTurnFlow');
const { synthesizeToBase64Chunks } = require('../../lib/polly');
const { invokeModelStream, buildInterviewPrompt, buildWebsiteTeachPrompt } = require('../../lib/bedrock');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { fetchAndCleanContent } = require('../../lib/scraper');
const { getConceptsBySession } = require('../../models/conceptState');
const { processUserTurn, parseBedrockJSON } = require('../../services/interviewService');
const terminateSession = require('./terminateSession');

const SUPPORTED_VOICES = ['Tiffany', 'Matthew', 'Gregory', 'Ivy', 'Joanna', 'Kendra', 'Kimberly', 'Salli', 'Joey', 'Justin', 'Kevin', 'Patrick', 'Stephen', 'Ruth'];

exports.handler = async (event) => {
    for (const record of event.Records) {
        const body = JSON.parse(record.body);
        const { connectionId, sessionId, text, isSilence, moduleType, type } = body;
        
        console.info(`[AsyncWorker] Processing ${type} for session ${sessionId}`);

        try {
            if (type === 'session_init') {
                await handleAsyncSessionInit(connectionId, sessionId, moduleType);
            } else if (type === 'text_transcript' || type === 'silence_detected') {
                await handleAsyncUserTurn(connectionId, sessionId, text, isSilence);
            }
        } catch (error) {
            if (error instanceof StaleConnectionError) {
                console.warn(`[AsyncWorker] Halted processing for stale connection ${connectionId}`);
            } else {
                console.error(`[AsyncWorker] Fatal error for session ${sessionId}:`, error);
                await postToConnection(connectionId, {
                    type: 'error',
                    payload: { message: 'An internal error occurred. Please try again.' }
                }).catch(() => {});
            }
        }
    }
};

async function handleAsyncSessionInit(connectionId, sessionId, moduleType) {
    const session = await getSession(sessionId);
    if (!session) return;

    // Transition to AI_SPEAKING
    await transitionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, { turnCount: 0 });

    // Stream initial response
    const prompt = await buildInitialPrompt(session);
    await streamAIResponse(connectionId, sessionId, session, prompt);

    // Transition to USER_RESPONDING
    await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
}

async function handleAsyncUserTurn(connectionId, sessionId, text, isSilence) {
    const result = await processUserTurn(sessionId, text, isSilence);

    if (result.state === 'TERMINATED') {
        await terminateSession.handler({ body: JSON.stringify({ sessionId, reason: result.reason }) });
        await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
        return;
    }

    const session = await getSession(sessionId);
    
    // Prepare prompt for next turn if not pre-generated
    let prompt = null;
    if (!result.nextAIResponse) {
        prompt = await buildNextTurnPrompt(session);
    }

    // Lock into AI_SPEAKING for streaming
    await transitionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, {
        accumulatedScores: result.accumulatedScores,
        turnCount: result.turnCount,
        currentConceptId: result.currentConceptId
    });

    if (result.nextAIResponse) {
        await streamPreGeneratedResponse(connectionId, sessionId, session, result.nextAIResponse);
    } else {
        await streamAIResponse(connectionId, sessionId, session, prompt);
    }

    // Transition back to USER_RESPONDING
    await transitionState(sessionId, INTERVIEW_STATES.USER_RESPONDING);
}

async function streamAIResponse(connectionId, sessionId, session, prompt) {
    const pollyVoice = SUPPORTED_VOICES.includes(session.voiceId) ? session.voiceId : 'Tiffany';
    const engine = session.itemData?.engine || 'generative';
    
    let fullText = "";
    let sentenceBuffer = "";
    let globalAudioChunkIndex = 0;
    let lastProcessPromise = Promise.resolve();

    const processSentence = async (sentence) => {
        if (!sentence.trim()) return;
        
        // Clean text if it contains JSON fragments
        let cleanSentence = sentence;
        const jsonMatch = sentence.match(/\{(?:[^{}]|(\{[^{}]*\}))*\}/);
        if (jsonMatch) {
            const parsed = parseBedrockJSON(jsonMatch[0]);
            cleanSentence = parsed.question || parsed.response || sentence;
        }

        // Chain the Polly synthesis to ensure order
        lastProcessPromise = lastProcessPromise.then(async () => {
            try {
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
                if (err instanceof StaleConnectionError) throw err;
                console.error('[AsyncWorker] Polly synthesis failed:', err);
                await postToConnection(connectionId, {
                    type: 'error',
                    payload: { message: 'Audio synthesis failed', code: 'TTS_ERROR' }
                }).catch(() => {});
                // Resolve cleanly to avoid crashing the container
            }
        });
        return lastProcessPromise;
    };

    try {
        await postToConnection(connectionId, { type: 'session_text_stream', payload: { text: "", status: "thinking" } });

        await invokeModelStream(undefined, prompt, async (token) => {
            fullText += token;
            sentenceBuffer += token;

            const isBoundary = /[.!?](\s|$)/.test(sentenceBuffer) && sentenceBuffer.trim().length >= 25;
            if (isBoundary) {
                const toProcess = sentenceBuffer;
                sentenceBuffer = "";
                await processSentence(toProcess);
            }

            // Periodic text updates
            if (fullText.length % 10 === 0) {
                await postToConnection(connectionId, { type: 'session_text_stream', payload: { text: fullText } });
            }
        });

        if (sentenceBuffer.trim()) {
            await processSentence(sentenceBuffer);
        }

        await lastProcessPromise;

        // Finalize
        await saveTranscript(sessionId, session.turnCount, SPEAKERS.AI, fullText);
        await postToConnection(connectionId, {
            type: 'question_text_update',
            payload: { sessionId, turnIndex: session.turnCount, questionText: fullText, currentConceptId: session.currentConceptId }
        });

        // Final audio chunk with chunkIndex
        await postToConnection(connectionId, {
            type: 'tts_audio_chunk',
            payload: { audioData: '', isLast: true, chunkIndex: globalAudioChunkIndex }
        });

    } catch (error) {
        if (error instanceof StaleConnectionError) throw error;
        throw error;
    }
}

async function streamPreGeneratedResponse(connectionId, sessionId, session, text) {
    const pollyVoice = SUPPORTED_VOICES.includes(session.voiceId) ? session.voiceId : 'Tiffany';
    const engine = session.itemData?.engine || 'generative';
    
    await saveTranscript(sessionId, session.turnCount, SPEAKERS.AI, text);
    await postToConnection(connectionId, { type: 'session_text_stream', payload: { text } });
    
    let chunkIndex = 0;
    for await (const audioChunk of synthesizeToBase64Chunks(text, { VoiceId: pollyVoice, Engine: engine })) {
        await postToConnection(connectionId, {
            type: 'tts_audio_chunk',
            payload: { chunkIndex: chunkIndex++, audioData: audioChunk.audioData, isLast: false }
        });
    }
    
    await postToConnection(connectionId, { type: 'tts_audio_chunk', payload: { audioData: '', isLast: true, chunkIndex: chunkIndex } });
    await postToConnection(connectionId, { type: 'question_text_update', payload: { sessionId, turnIndex: session.turnCount, questionText: text } });
}

async function buildInitialPrompt(session) {
    const userId = session.userId;
    const transcripts = await getTranscriptBySession(session.sessionId);
    const history = transcripts.map(t => ({ role: t.speaker === 'USER' ? 'user' : 'assistant', content: [{ text: t.text }] }));

    if (session.moduleType === 'WEBSITE') {
        const scraped = await fetchAndCleanContent(session.itemData?.websiteUrl);
        const concepts = await getConceptsBySession(session.sessionId);
        const targetConcept = concepts.length > 0 ? concepts[0].conceptId : 'General Overview';
        return buildWebsiteTeachPrompt(targetConcept, scraped.content, history, false);
    } else {
        let context = "Professional Background";
        if (session.moduleType === 'RESUME') {
            const user = await getUserById(userId);
            const resume = await getResumeById(session.itemData?.resumeId || user.activeResumeId);
            context = resume?.parsedData || context;
        }
        return buildInterviewPrompt(context, history, 0, session.moduleType);
    }
}

async function buildNextTurnPrompt(session) {
    const transcripts = await getTranscriptBySession(session.sessionId);
    const history = transcripts.map(t => ({ role: t.speaker === 'USER' ? 'user' : 'assistant', content: [{ text: t.text }] }));

    if (session.moduleType === 'WEBSITE') {
        const scraped = await fetchAndCleanContent(session.itemData?.websiteUrl);
        const targetConcept = session.currentConceptId || 'General Overview';
        return buildWebsiteTeachPrompt(targetConcept, scraped.content, history, true);
    } else {
        let context = "Professional Background";
        if (session.moduleType === 'RESUME') {
            const user = await getUserById(session.userId);
            const resume = await getResumeById(session.itemData?.resumeId || user.activeResumeId);
            context = resume?.parsedData || context;
        }
        return buildInterviewPrompt(context, history, session.turnCount, session.moduleType);
    }
}
