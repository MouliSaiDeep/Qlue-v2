const { getSession, updateSessionState } = require('../models/session');
const { SPEAKERS, saveTranscript, getTranscriptBySession } = require('../models/transcript');
const { INTERVIEW_STATES } = require('../handlers/interview/controlTurnFlow');
const { invokeModel, buildScoringPrompt, buildWebsiteTeachPrompt, buildSelfIntroEvalPrompt } = require('../lib/bedrock');
const { CONCEPT_STATES, updateConceptState } = require('../models/conceptState');
const { getConceptsBySession } = require('../models/conceptState');

/**
 * Robust JSON extraction from LLM responses that might contain conversational padding.
 */
function parseBedrockJSON(text) {
    if (!text) return {};
    try {
        // Find the first { and the last }
        const match = text.match(/\{[\s\S]*?\}/);
        if (match) {
            return JSON.parse(match[0]);
        }
        return JSON.parse(text);
    } catch (e) {
        console.warn('[InterviewService] JSON Parse failed, returning empty object:', e.message);
        return {};
    }
}

/**
 * Core business logic for processing user input and preparing next AI response.
 * Extracted from processUserInput.js to avoid Lambda-inception.
 */
async function processUserTurn(sessionId, textTranscript, isSilence, currentConceptIdInput) {
    const session = await getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const currentConceptId = currentConceptIdInput || session.currentConceptId;

    // --- 1. SILENCE NEGOTIATION W/ RETRIES ---
    if (isSilence) {
        await updateSessionState(sessionId, INTERVIEW_STATES.SILENCE_DETECTED, session.currentState);
        const silRetries = (session.silenceRetries || 0) + 1;
        
        if (silRetries >= 3) {
            return { state: 'TERMINATED', reason: 'SILENCE_TIMEOUT' };
        }

        const retryMessage = silRetries === 1 
            ? "Are you still there? I'm listening whenever you're ready." 
            : "I haven't heard anything. Take your time, let me know if you need me to repeat the question or if you want to wrap up.";
        
        await updateSessionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, INTERVIEW_STATES.SILENCE_DETECTED, { silenceRetries: silRetries });

        return {
            nextAIResponse: retryMessage,
            state: INTERVIEW_STATES.AI_SPEAKING,
            silenceRetries: silRetries,
            message: 'Silence protocol engaged.'
        };
    }

    // --- 2. STANDARD PROCESS PIPELINE ---
    if (textTranscript) await saveTranscript(sessionId, session.turnCount, SPEAKERS.USER, textTranscript);

    // Scoring
    const dimensions = {
        RESUME: ['technical accuracy', 'communication clarity', 'fluency', 'depth of knowledge', 'use of examples'],
        WEBSITE: ['concept understanding', 'learning agility', 'application ability', 'fluency', 'comprehension accuracy'],
        HR: ['STAR format adherence', 'teamwork demonstration', 'ethical thinking', 'cultural alignment', 'vocabulary'],
        INTRO: ['clarity of message', 'confidence', 'structure', 'relevance of content', 'brevity']
    };
    const dims = dimensions[session.moduleType] || dimensions.RESUME;
    
    let scores = {};
    if (textTranscript && textTranscript.trim().length > 2) {
        const promptParams = buildScoringPrompt(session.moduleType, textTranscript, dims);
        const bedrockResult = await invokeModel(undefined, promptParams);
        if (bedrockResult?.content?.[0]?.text) {
            scores = parseBedrockJSON(bedrockResult.content[0].text);
        }
    }

    // Update Scores using Running Average
    const newAccumulated = { ...session.accumulatedScores };
    const turnNumber = (session.turnCount || 0) + 1;
    for (const [dim, val] of Object.entries(scores)) {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
            const prevAvg = newAccumulated[dim] || 0;
            // Running average: newAvg = prevAvg + (newVal - prevAvg) / n
            newAccumulated[dim] = Math.round(prevAvg + (numVal - prevAvg) / turnNumber);
        }
    }

    // Tutoring Logic
    if (session.moduleType === 'WEBSITE' && currentConceptId) {
        const masteryScore = parseFloat(scores['concept understanding'] || 0);
        const newState = masteryScore >= 70 ? CONCEPT_STATES.MASTERED : CONCEPT_STATES.TUTORED;
        await updateConceptState(sessionId, currentConceptId, newState, 1);
    }

    // Time Limit Check
    const sessionAgeMs = Date.now() - new Date(session.startTime).getTime();
    if (sessionAgeMs > 15 * 60 * 1000) {
        return { state: 'TERMINATED', reason: 'TIME_LIMIT', accumulatedScores: newAccumulated };
    }

    // Next Response Generation (for WEBSITE/INTRO)
    let nextAIResponse = "";
    let targetConcept = null;
    
    if (session.moduleType === 'WEBSITE') {
        const content = session.itemData?.scrapedSummary || "Website content loaded from context.";
        const concepts = await getConceptsBySession(sessionId);
        targetConcept = currentConceptId || (concepts.length > 0 ? concepts[0].conceptId : "General Overview");

        const history = (await getTranscriptBySession(sessionId)).map(t => ({
            role: t.speaker === 'USER' ? 'user' : 'assistant',
            content: [{ text: t.text }]
        }));
        const prompt = buildWebsiteTeachPrompt(targetConcept, content, history, true);
        
        const bedrockResult = await invokeModel(undefined, prompt);
        if (bedrockResult.content?.[0]?.text) {
            const parsed = parseBedrockJSON(bedrockResult.content[0].text);
            nextAIResponse = parsed.response || parsed.question || parsed.feedback || null;
            if (parsed.isCorrect) {
                await updateConceptState(sessionId, targetConcept, CONCEPT_STATES.MASTERED, 1);
            }
        }
        if (!nextAIResponse) nextAIResponse = `Let's talk about ${targetConcept}. What do you know about it?`;
    } else if (session.moduleType === 'INTRO') {
        const prompt = buildSelfIntroEvalPrompt(textTranscript);
        const bedrockResult = await invokeModel(undefined, prompt);
        if (bedrockResult.content?.[0]?.text) {
            const parsed = parseBedrockJSON(bedrockResult.content[0].text);
            nextAIResponse = parsed.response || parsed.feedback || null;
        }
        if (!nextAIResponse) nextAIResponse = "Thanks! Let's move on.";
    }

    return {
        success: true,
        sessionId,
        turnCount: session.turnCount + 1,
        accumulatedScores: newAccumulated,
        nextAIResponse,
        currentConceptId: targetConcept,
        scoresGenerated: scores
    };
}

module.exports = {
    processUserTurn,
    parseBedrockJSON
};
