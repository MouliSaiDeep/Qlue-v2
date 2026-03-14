const { getSession } = require('../../models/session');
const { SPEAKERS, saveTranscript } = require('../../models/transcript');
const { transitionState, INTERVIEW_STATES } = require('./controlTurnFlow');
const { invokeModel, buildScoringPrompt } = require('../../lib/bedrock');
const { CONCEPT_STATES, updateConceptState } = require('../../models/conceptState');
const generateQuestion = require('./generateQuestion');

// Defined Module Scoring Dimensions
const DIMENSIONS = {
    RESUME: ['technical accuracy', 'communication clarity', 'fluency', 'depth of knowledge', 'use of examples'],
    WEBSITE: ['concept understanding', 'learning agility', 'application ability', 'fluency', 'comprehension accuracy'],
    HR: ['STAR format adherence', 'teamwork demonstration', 'ethical thinking', 'cultural alignment', 'vocabulary']
};

/**
 * Validates the DTO payload for processing user input.
 */
function validateDTO(body) {
    if (!body.sessionId || typeof body.sessionId !== 'string') {
        throw new Error('Invalid DTO: sessionId is required');
    }
    if (!body.textTranscript || typeof body.textTranscript !== 'string') {
        throw new Error('Invalid DTO: textTranscript must be a string');
    }
}

/**
 * Handle incoming text transcript from the candidate
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        validateDTO(body);

        const { sessionId, textTranscript, currentConceptId } = body;

        const session = await getSession(sessionId);
        if (!session) throw new Error('Session not found');

        if (session.currentState !== INTERVIEW_STATES.USER_RESPONDING) {
            throw new Error(`Cannot process input while in state: ${session.currentState}`);
        }

        // 1. Lock State to PROCESSING_RESPONSE
        await transitionState(sessionId, INTERVIEW_STATES.PROCESSING_RESPONSE);

        // 2. Save User's Transcript
        await saveTranscript(sessionId, session.turnCount, SPEAKERS.USER, textTranscript);

        // 3. Determine Dimensions & Evaluate Output
        const dims = DIMENSIONS[session.moduleType] || DIMENSIONS.RESUME;
        const promptParams = buildScoringPrompt(session.moduleType, textTranscript, dims);
        
        let scores = {};
        try {
            const bedrockResult = await invokeModel(undefined, promptParams);
            if (bedrockResult) scores = bedrockResult; 
        } catch (e) {
            console.error('Bedrock evaluation failed to parse scores cleanly.', e);
        }

        // 4. Adaptive Tutor Strategy
        if (session.moduleType === 'WEBSITE' && currentConceptId) {
            const masteryScore = parseInt(scores['concept understanding'] || 0, 10);
            const newState = masteryScore >= 70 ? CONCEPT_STATES.MASTERED : CONCEPT_STATES.TUTORED;
            await updateConceptState(sessionId, currentConceptId, newState, 1);
        }

        // 5. Aggregate Module Dimensions
        const newAccumulated = { ...session.accumulatedScores };
        for (const [dim, val] of Object.entries(scores)) {
            const numVal = parseInt(val, 10);
            if (!isNaN(numVal)) {
                newAccumulated[dim] = (newAccumulated[dim] || 0) + numVal;
            }
        }

        // 6. Generate the follow-up Question directly via Nithin's generation wrapper
        const genQstnEvent = {
            body: JSON.stringify({
                sessionId,
                moduleType: session.moduleType,
                currentConceptId, // Optional, passes state if adaptive
            })
        };
        const genQstnRes = await generateQuestion.handler(genQstnEvent);
        const resolvedFollowUpData = JSON.parse(genQstnRes.body);

        // 7. Advance Turn & Trigger Next Speaking phase
        await transitionState(sessionId, INTERVIEW_STATES.AI_SPEAKING, {
            turnCount: session.turnCount + 1,
            silenceRetries: 0,
            accumulatedScores: newAccumulated
        }); 

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                scoresGenerated: scores,
                accumulatedScores: newAccumulated,
                nextAIResponse: resolvedFollowUpData.aiResponse, // This goes to Rishi's Synthesize pipeline next
                state: INTERVIEW_STATES.AI_SPEAKING,
                message: 'Turn completed.'
            })
        };
    } catch (err) {
        console.error('ProcessUserInput Failed:', err);
        return { statusCode: err.message.includes('Invalid DTO') ? 400 : 500, body: JSON.stringify({ error: err.message }) };
    }
}
