const { getSession, updateSessionState } = require('../../models/session');
const { SPEAKERS, saveTranscript } = require('../../models/transcript');
const { transitionState, INTERVIEW_STATES } = require('./controlTurnFlow');
const { invokeModel, buildScoringPrompt, buildWebsiteTeachPrompt, buildSelfIntroEvalPrompt } = require('../../lib/bedrock');
const { CONCEPT_STATES, updateConceptState } = require('../../models/conceptState');
const generateQuestion = require('./generateQuestion');
const terminateSession = require('./terminateSession');

// Defined Module Scoring Dimensions
// Enforcing the new Week 3 Advanced 1-10 scales
const DIMENSIONS = {
    RESUME: ['technical accuracy', 'communication clarity', 'fluency', 'depth of knowledge', 'use of examples'],
    WEBSITE: ['concept understanding', 'learning agility', 'application ability', 'fluency', 'comprehension accuracy'],
    HR: ['STAR format adherence', 'teamwork demonstration', 'ethical thinking', 'cultural alignment', 'vocabulary']
};

function validateDTO(body) {
    if (!body.sessionId || typeof body.sessionId !== 'string') {
        throw new Error('Invalid DTO: sessionId is required');
    }
}

exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        validateDTO(body);

        const { sessionId, textTranscript, currentConceptId, isSilence } = body;

        const session = await getSession(sessionId);
        if (!session) throw new Error('Session not found');

        // [Mouli Week 4: Deadlock Recovery]
        if (session.currentState === INTERVIEW_STATES.PROCESSING_RESPONSE) {
            const deadlockTime = Date.now() - new Date(session.updatedAt || session.startTime).getTime();
            if (deadlockTime > 60 * 1000) {
                // Recover the session silently
                return {
                    statusCode: 200,
                    body: JSON.stringify({
                        sessionId,
                        nextAIResponse: "Sorry, I lost my train of thought. Let's continue where we left off.",
                        state: INTERVIEW_STATES.AI_SPEAKING,
                        message: 'Recovered from Deadlock.'
                    })
                };
            }
        }

        if (session.currentState !== INTERVIEW_STATES.USER_RESPONDING && session.currentState !== INTERVIEW_STATES.PROCESSING_RESPONSE) {
            throw new Error(`Cannot process input while in state: ${session.currentState}`);
        }

        // --- 1. SILENCE NEGOTIATION W/ RETRIES ---
        if (isSilence) {
            await transitionState(sessionId, INTERVIEW_STATES.SILENCE_DETECTED);
            const silRetries = (session.silenceRetries || 0) + 1;
            
            // Strike 3 = Timeout Terminal State
            if (silRetries >= 3) {
                return await terminateSession.handler({ body: JSON.stringify({ sessionId, reason: 'SILENCE_TIMEOUT' }) });
            }

            // Fallback / Active Checks
            const retryMessage = silRetries === 1 
                ? "Are you still there? I'm listening whenever you're ready." 
                : "I haven't heard anything. Take your time, let me know if you need me to repeat the question or if you want to wrap up.";
            
            // Update session and return retry logic
            await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.SILENCE_DETECTED, { silenceRetries: silRetries });

            return {
                statusCode: 200,
                body: JSON.stringify({
                    sessionId,
                    nextAIResponse: retryMessage,
                    state: INTERVIEW_STATES.AI_SPEAKING,
                    silenceRetries: silRetries,
                    message: 'Silence protocol engaged. Retrying.'
                })
            };
        }


        // --- 2. STANDARD PROCESS PIPELINE ---
        
        await transitionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE);

        if (session.silenceRetries > 0) {
            await updateSessionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.PROCESSING_RESPONSE, { silenceRetries: 0 });
        }

        if (textTranscript) await saveTranscript(sessionId, session.turnCount, SPEAKERS.USER, textTranscript);

        const dims = DIMENSIONS[session.moduleType] || DIMENSIONS.RESUME;
        const promptParams = buildScoringPrompt(session.moduleType, textTranscript || '', dims);
        
        let scores = {};
        try {
            const bedrockResult = await invokeModel(undefined, promptParams);
            if (bedrockResult) scores = bedrockResult; 
        } catch (e) {
            console.error('Bedrock evaluation failed cleanly.', e);
        }

        // --- 3. ADAPTIVE TUTORING ---
        if (session.moduleType === 'WEBSITE' && currentConceptId) {
            const masteryScore = parseInt(scores['concept understanding'] || 0, 10);
            const newState = masteryScore >= 70 ? CONCEPT_STATES.MASTERED : CONCEPT_STATES.TUTORED;
            await updateConceptState(sessionId, currentConceptId, newState, 1);
        }

        const newAccumulated = { ...session.accumulatedScores };
        for (const [dim, val] of Object.entries(scores)) {
            const numVal = parseInt(val, 10);
            if (!isNaN(numVal)) newAccumulated[dim] = (newAccumulated[dim] || 0) + numVal;
        }

        // --- 4. TERMINATION CHECK (Time Limit) ---
        const sessionAgeMs = Date.now() - new Date(session.startTime).getTime();
        if (sessionAgeMs > 15 * 60 * 1000) {
            await updateSessionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE, INTERVIEW_STATES.PROCESSING_RESPONSE, { accumulatedScores: newAccumulated });
            return await terminateSession.handler({ body: JSON.stringify({ sessionId, reason: 'TIME_LIMIT' }) });
        }

        // --- 5. GENERATE NEXT RESPONSE (Specialized for Tutor Mode) ---
        let nextAIResponse = "";
        let onlyQuestion = "";
        
        if (session.moduleType === 'WEBSITE') {
            const { scrapeWebsite } = require('../../lib/scraper');
            const { getConceptsForWebsite } = require('../../models/conceptState');
            
            const websiteUrl = session.itemData?.websiteUrl || "";
            const content = await scrapeWebsite(websiteUrl);
            const concepts = await getConceptsForWebsite(websiteUrl);
            const targetConcept = currentConceptId || (concepts.length > 0 ? concepts[0] : "General Overview");

            const prompt = buildWebsiteTeachPrompt(targetConcept, content, (await getTranscriptBySession(sessionId)).map(t => ({
                role: t.speaker === 'USER' ? 'user' : 'assistant',
                content: t.text
            })), true);
            
            const bedrockResult = await invokeModel(undefined, { messages: prompt });
            if (bedrockResult.content?.[0]?.text) {
                try {
                    const parsed = JSON.parse(bedrockResult.content[0].text);
                    nextAIResponse = parsed.response;
                    onlyQuestion = nextAIResponse;
                    
                    // Update concept mastery if correct
                    if (parsed.isCorrect) {
                        await updateConceptState(sessionId, targetConcept, CONCEPT_STATES.MASTERED, 1);
                    }
                } catch (e) {
                    nextAIResponse = bedrockResult.content[0].text;
                    onlyQuestion = nextAIResponse;
                }
            }
        } else if (session.moduleType === 'INTRO') {
            const prompt = buildSelfIntroEvalPrompt(textTranscript);
            const bedrockResult = await invokeModel(undefined, { messages: prompt });
            
            if (bedrockResult.content?.[0]?.text) {
                try {
                    const parsed = JSON.parse(bedrockResult.content[0].text);
                    nextAIResponse = parsed.response;
                    onlyQuestion = nextAIResponse;
                } catch (e) {
                    nextAIResponse = bedrockResult.content[0].text;
                    onlyQuestion = nextAIResponse;
                }
            }
        } else {
            // Standard Interview Flow
            const genQstnEvent = {
                body: JSON.stringify({ sessionId, moduleType: session.moduleType, currentConceptId })
            };
            const genQstnRes = await generateQuestion.handler(genQstnEvent);
            const bodyJson = JSON.parse(genQstnRes.body);
            const resolvedFollowUpData = bodyJson.data;

            if (!bodyJson.success || !resolvedFollowUpData) {
                throw new Error('Follow-up question generation failed');
            }

            nextAIResponse = resolvedFollowUpData.aiResponse;
            onlyQuestion = resolvedFollowUpData.onlyQuestion || nextAIResponse;
        }

        await transitionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, {
            turnCount: session.turnCount + 1,
            accumulatedScores: newAccumulated
        }); 

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true, // Ensuring standard success wrapper for sendTextHandler
                data: {
                    sessionId,
                    scoresGenerated: scores,
                    accumulatedScores: newAccumulated,
                    nextAIResponse: nextAIResponse,
                    onlyQuestion: onlyQuestion,
                    state: INTERVIEW_STATES.AI_SPEAKING,
                    message: 'Turn completed.'
                }
            })
        };

    } catch (err) {
        console.error('ProcessUserInput Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
}
