const { getSession, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { postToConnection, StaleConnectionError } = require('../../lib/websocket');
const { SPEAKERS, saveTranscript, getTranscriptBySession } = require('../../models/transcript');
const { synthesizeToBase64Chunks } = require('../../lib/polly');
const { invokeModelStream, buildInterviewPrompt, buildWebsiteTeachPrompt } = require('../../lib/bedrock');
const { putObject, generatePresignedUrl } = require('../../lib/s3');
const { getResumeById } = require('../../models/resume');
const { getUserById } = require('../../models/user');
const { fetchAndCleanContent } = require('../../lib/scraper');
const { getConceptsBySession } = require('../../models/conceptState');
const { processUserTurn, parseBedrockJSON } = require('../../services/interviewService');
const terminateSession = require('./terminateSession');

const SUPPORTED_VOICES = (() => {
    const voices = process.env.ALLOWED_VOICES?.split(',').map(v => v.trim()).filter(Boolean);
    return voices && voices.length ? voices : ['Tiffany', 'Ruth', 'Joanna', 'Matthew', 'Stephen'];
})();

exports.handler = async (event) => {
    for (const record of event.Records) {
        const body = JSON.parse(record.body);
        const { connectionId, sessionId, text, isSilence, moduleType, type, currentConceptId, expectedVersion, voiceId, engine } = body;
        
        console.info(`[AsyncWorker] Processing ${type} for session ${sessionId}`);

        try {
            if (type === 'session_init') {
                await handleAsyncSessionInit(connectionId, sessionId, voiceId, engine);
            } else if (type === 'turn_submit') {
                await handleAsyncUserTurn(connectionId, sessionId, text, isSilence, currentConceptId, expectedVersion, voiceId, engine);
            }
        } catch (error) {
            if (error instanceof StaleConnectionError) {
                console.warn(`[AsyncWorker] Halted processing for stale connection ${connectionId}`);
            } else {
                console.error(`[AsyncWorker] Fatal error for session ${sessionId}:`, error);
                await postToConnection(connectionId, {
                    type: 'turn_error',
                    payload: { message: 'An internal error occurred. Please try again.', code: 'INTERNAL_ERROR' }
                }).catch(() => {});
            }
        }
    }
};

async function handleAsyncSessionInit(connectionId, sessionId, voiceId, engine) {
    const session = await getSession(sessionId);
    if (!session) return;

    await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, session.currentState, { turnCount: 0 });
    const prompt = await buildInitialPrompt(session);

    try {
        await generateAtomicTurn(connectionId, sessionId, prompt, null, voiceId, engine);
    } catch (error) {
        await handleTurnError(connectionId, sessionId, error);
    }
}

async function handleAsyncUserTurn(connectionId, sessionId, text, isSilence, currentConceptId, expectedVersion, voiceId, engine) {
    const session = await getSession(sessionId);
    if (!session) return;

    if ([INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.PROCESSING_RESPONSE].includes(session.currentState)) {
        console.warn(`[AsyncWorker] Duplicate or stale turn_submit received for session ${sessionId} in state ${session.currentState}`);
        return;
    }

    let claimedSession;
    try {
        claimedSession = await updateSessionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, session.currentState, {
            expectedVersion: expectedVersion !== undefined ? expectedVersion : session.version
        });
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            console.warn(`[AsyncWorker] Concurrent turn_submit detected for session ${sessionId}; skipping duplicate.`);
            return;
        }
        throw error;
    }

    const result = await processUserTurn(sessionId, text, isSilence, currentConceptId);

    if (result.state === 'TERMINATED') {
        await terminateSession.handler({ body: JSON.stringify({ sessionId, reason: result.reason }) });
        await postToConnection(connectionId, { type: 'termination', payload: { sessionId } });
        return;
    }

    const postProcessSession = await getSession(sessionId);
    const nextText = result.nextAIResponse || null;
    const nextTurnCount = result.turnCount || postProcessSession.turnCount;
    const nextConceptId = result.currentConceptId || postProcessSession.currentConceptId;

    await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.PROCESSING_RESPONSE, {
        turnCount: nextTurnCount,
        currentConceptId: nextConceptId,
        accumulatedScores: result.accumulatedScores,
        expectedVersion: claimedSession.version
    });

    let prompt = null;
    if (!nextText) {
        const latestSession = await getSession(sessionId);
        prompt = await buildNextTurnPrompt(latestSession);
    }

    try {
        await generateAtomicTurn(connectionId, sessionId, prompt, nextText, voiceId, engine);
    } catch (error) {
        await handleTurnError(connectionId, sessionId, error);
    }
}

async function generateAtomicTurn(connectionId, sessionId, prompt, preGeneratedText, voiceId, engine) {
    const session = await getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const pollyVoice = SUPPORTED_VOICES.includes(voiceId)
        ? voiceId
        : (SUPPORTED_VOICES.includes(session.voiceId) ? session.voiceId : 'Tiffany');
    const pollyEngine = engine || session.itemData?.engine || 'generative';

    let fullText = preGeneratedText ? String(preGeneratedText) : '';

    if (!fullText.trim()) {
        fullText = '';
        await invokeModelStream(undefined, prompt, (token) => {
            fullText += token;
        });

        try {
            const parsed = JSON.parse(fullText);
            fullText = parsed.question || parsed.response || fullText;
        } catch (e) {
            // Keep raw model output
        }
    }

    fullText = String(fullText).trim();
    if (!fullText) {
        fullText = "I apologize, I didn't generate a response. Let's continue.";
    }

    // Parse acknowledgment || question format for better conversational output
    let acknowledgment = '';
    let question = fullText;
    if (fullText.includes('||')) {
        const parts = fullText.split('||', 2);
        acknowledgment = parts[0].trim();
        question = parts[1].trim();
        fullText = `${acknowledgment} ${question}`.trim();
    }

    const audioBuffers = [];
    for await (const chunk of synthesizeToBase64Chunks(fullText, { VoiceId: pollyVoice, Engine: pollyEngine })) {
        audioBuffers.push(Buffer.from(chunk.audioData, 'base64'));
    }
    const fullAudioBase64 = Buffer.concat(audioBuffers).toString('base64');

    let audioUrl = '';
    let audioData = fullAudioBase64;
    const audioBucket = process.env.AUDIO_BUCKET;
    const expirationSeconds = parseInt(process.env.AUDIO_URL_EXPIRATION_SECONDS || '900', 10);

    if (audioBucket) {
        try {
            const audioBuffer = Buffer.from(fullAudioBase64, 'base64');
            const audioKey = `interview-audio/${sessionId}/${session.turnCount || 0}_${Date.now()}.mp3`;
            await putObject(audioBucket, audioKey, audioBuffer, 'audio/mpeg');
            audioUrl = await generatePresignedUrl(audioBucket, audioKey, 'getObject', expirationSeconds);
            audioData = '';
        } catch (uploadError) {
            console.warn(`[AsyncWorker] Failed to upload audio to S3, falling back to inline payload: ${uploadError.message}`);
        }
    } else if (Buffer.byteLength(fullAudioBase64, 'utf8') > 110000) {
        console.warn(`[AsyncWorker] Audio payload size is large (${Buffer.byteLength(fullAudioBase64, 'utf8')} bytes). Configure AUDIO_BUCKET to avoid API Gateway limits.`);
    }

    await saveTranscript(sessionId, session.turnCount, SPEAKERS.AI, question);

    await postToConnection(connectionId, {
        type: 'turn_complete',
        payload: {
            sessionId,
            turnIndex: session.turnCount,
            questionText: fullText,
            audioData,
            audioUrl,
            currentConceptId: session.currentConceptId,
            state: 'USER_RESPONDING',
            timestamp: Date.now()
        }
    });

    await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.AI_SPEAKING, {
        questionText: fullText,
        currentConceptId: session.currentConceptId
    });
}

async function handleTurnError(connectionId, sessionId, error) {
    console.error(`[AsyncWorker] Turn generation error for ${sessionId}:`, error);

    const session = await getSession(sessionId);
    if (session && session.currentState === INTERVIEW_STATES.AI_SPEAKING) {
        try {
            await updateSessionState(sessionId, INTERVIEW_STATES.USER_RESPONDING, INTERVIEW_STATES.AI_SPEAKING);
        } catch (e) {
            console.warn('[AsyncWorker] Failed to reset session state after error:', e.message);
        }
    }

    await postToConnection(connectionId, {
        type: 'turn_error',
        payload: { sessionId, message: error?.message || 'Failed to generate turn', code: 'TURN_GENERATION_FAILED' }
    }).catch(() => {});
}

async function buildInitialPrompt(session) {
    const transcripts = await getTranscriptBySession(session.sessionId);
    const history = transcripts.map(t => ({ role: t.speaker === 'USER' ? 'user' : 'assistant', content: [{ text: t.text }] }));

    if (session.moduleType === 'WEBSITE') {
        const websiteUrl = session.itemData?.websiteUrl;
        let content = 'No content available.';
        try {
            const scraped = await fetchAndCleanContent(websiteUrl);
            content = scraped.content;
        } catch (e) {
            console.warn('[AsyncWorker] Website scrape failed, using fallback content.');
        }
        const concepts = await getConceptsBySession(session.sessionId);
        const targetConcept = concepts.length > 0 ? concepts[0].conceptId : 'General Overview';
        return buildWebsiteTeachPrompt(targetConcept, content, history, false);
    }

    let context = 'Professional Background';
    if (session.moduleType === 'RESUME') {
        const user = await getUserById(session.userId);
        const resume = await getResumeById(session.itemData?.resumeId || user.activeResumeId);
        context = resume?.parsedData || context;
    }
    return buildInterviewPrompt(context, history, 0, session.moduleType);
}

async function buildNextTurnPrompt(session) {
    const transcripts = await getTranscriptBySession(session.sessionId);
    const history = transcripts.map(t => ({ role: t.speaker === 'USER' ? 'user' : 'assistant', content: [{ text: t.text }] }));

    if (session.moduleType === 'WEBSITE') {
        const websiteUrl = session.itemData?.websiteUrl;
        let content = 'No content available.';
        try {
            const scraped = await fetchAndCleanContent(websiteUrl);
            content = scraped.content;
        } catch (e) {
            console.warn('[AsyncWorker] Website scrape failed, using fallback content.');
        }
        const targetConcept = session.currentConceptId || 'General Overview';
        return buildWebsiteTeachPrompt(targetConcept, content, history, true);
    }

    let context = 'Professional Background';
    if (session.moduleType === 'RESUME') {
        const user = await getUserById(session.userId);
        const resume = await getResumeById(session.itemData?.resumeId || user.activeResumeId);
        context = resume?.parsedData || context;
    }
    return buildInterviewPrompt(context, history, session.turnCount, session.moduleType);
}
