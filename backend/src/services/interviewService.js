const { getSession, updateSessionState, updateConceptState, getConceptsBySession, INTERVIEW_STATES: SESSION_INTERVIEW_STATES } = require('../models/session');
const { SPEAKERS, saveTranscript, getTranscriptBySession } = require('../models/transcript');
const { transitionState, INTERVIEW_STATES } = require('../handlers/interview/controlTurnFlow');
const { invokeModel, buildScoringPrompt, buildWebsiteTeachPrompt, buildSelfIntroEvalPrompt } = require('../lib/bedrock');

const CONCEPT_STATES = {
    UNADDRESSED: 'UNADDRESSED',
    TUTORED: 'TUTORED',
    MASTERED: 'MASTERED'
};

/**
 * Robust JSON extraction from LLM responses.
 */
function parseBedrockJSON(text) {
    if (!text) return {};
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        return JSON.parse(text);
    } catch (e) {
        console.warn('[InterviewService] JSON Parse failed:', e.message);
        return {};
    }
}

/**
 * Core business logic for processing user input.
 */
async function processUserTurn(sessionId, textTranscript, isSilence, currentConceptIdInput) {
    const session = await getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const currentConceptId = currentConceptIdInput || session.currentConceptId;

    // --- 1. SILENCE NEGOTIATION ---
    if (isSilence) {
        await transitionState(sessionId, INTERVIEW_STATES.SILENCE_DETECTED);
        const silRetries = (session.silenceRetries || 0) + 1;
        
        if (silRetries >= 3) {
            return { state: 'TERMINATED', reason: 'SILENCE_TIMEOUT' };
        }

        const retryMessage = silRetries === 1 
            ? "Are you still there? I'm listening whenever you're ready." 
            : "I haven't heard anything. Take your time.";
        
        await transitionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, { silenceRetries: silRetries });

        return {
            nextAIResponse: retryMessage,
            state: INTERVIEW_STATES.AI_SPEAKING,
            silenceRetries: silRetries
        };
    }

    // --- 2. STANDARD PROCESS PIPELINE ---
    if (textTranscript) {
        await saveTranscript(sessionId, session.turnCount, SPEAKERS.USER, textTranscript);
    }

    // Scoring
    const dimensions = {
        RESUME: ['technical accuracy', 'communication clarity', 'fluency'],
        WEBSITE: ['concept understanding', 'learning agility'],
        HR: ['STAR format adherence', 'teamwork demonstration'],
        INTRO: ['clarity of message', 'confidence']
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

    // Update Scores
    const newAccumulated = { ...session.accumulatedScores };
    const turnNumber = (session.turnCount || 0) + 1;
    for (const [dim, val] of Object.entries(scores)) {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
            const prevAvg = newAccumulated[dim] || 0;
            newAccumulated[dim] = Math.round(prevAvg + (numVal - prevAvg) / turnNumber);
        }
    }

    // Tutoring Logic (V2 Inlined)
    if (session.moduleType === 'WEBSITE' && currentConceptId) {
        const masteryScore = parseFloat(scores['concept understanding'] || 0);
        const newState = masteryScore >= 70 ? CONCEPT_STATES.MASTERED : CONCEPT_STATES.TUTORED;
        await updateConceptState(sessionId, currentConceptId, newState, 1);
    }

    // Next Response Generation
    let nextAIResponse = "";
    let targetConcept = null;
    
    if (session.moduleType === 'WEBSITE') {
        const content = session.itemData?.scrapedSummary || "Content loaded.";
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
            nextAIResponse = parsed.response || parsed.question || null;
            if (parsed.isCorrect) {
                await updateConceptState(sessionId, targetConcept, CONCEPT_STATES.MASTERED, 1);
            }
        }
    } else if (session.moduleType === 'INTRO') {
        const prompt = buildSelfIntroEvalPrompt(textTranscript);
        const bedrockResult = await invokeModel(undefined, prompt);
        if (bedrockResult.content?.[0]?.text) {
            const parsed = parseBedrockJSON(bedrockResult.content[0].text);
            nextAIResponse = parsed.response || parsed.feedback || null;
        }
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
