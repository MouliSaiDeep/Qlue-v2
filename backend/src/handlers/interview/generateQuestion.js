const { getSession } = require('../../models/session');
const { getTranscriptWindow, saveTranscript, SPEAKERS } = require('../../models/transcript');
const { getConceptsBySession } = require('../../models/conceptState');
const { invokeModel, buildResumeQuestionPrompt, buildHRQuestionPrompt, buildWebsiteTeachPrompt } = require('../../lib/bedrock');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../../models/session');

/**
 * Helper to fetch a parsed resume directly from TBL-002
 */
async function getResumeContext(resumeId) {
    if (!resumeId) return {};
    const cmd = new GetCommand({
        TableName: process.env.RESUMES_TABLE_NAME || 'Resumes',
        Key: { resumeId }
    });
    const res = await docClient.send(cmd);
    return res.Item?.parsedData || {};
}

/**
 * Converts DB transcript format to generic conversational history for prompt
 */
function buildHistoryList(transcripts) {
    return transcripts.map(t => ({
        role: t.speaker === SPEAKERS.USER ? 'user' : 'assistant',
        content: t.content
    }));
}

/**
 * Generates the next question or response using Bedrock
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { sessionId, topic } = body; // `topic` for HR

        const session = await getSession(sessionId);
        if (!session) throw new Error('Session not found');

        // Fetch last 5 Q&A pairs
        const transcripts = await getTranscriptWindow(sessionId, 5);
        const history = buildHistoryList(transcripts);

        let finalPromptArgs;

        if (session.moduleType === 'RESUME') {
            const resumeData = await getResumeContext(session.resumeId || body.resumeId);
            finalPromptArgs = buildResumeQuestionPrompt(resumeData, history, session.turnCount);
        } 
        else if (session.moduleType === 'HR') {
            const currentTopic = topic || 'general behavioral';
            finalPromptArgs = buildHRQuestionPrompt(currentTopic, history);
        }
        else if (session.moduleType === 'WEBSITE') {
            // Adaptive Tutor
            const conceptId = body.currentConceptId || 'default-concept';
            const conceptState = (await getConceptsBySession(sessionId)).find(c => c.conceptId === conceptId) || { state: 'UNADDRESSED' };
            const content = body.contentSnippet || 'General knowledge area';
            finalPromptArgs = buildWebsiteTeachPrompt(conceptId, content, conceptState);
        }

        // Invoke Model
        const result = await invokeModel(undefined, finalPromptArgs);
        
        // Return output payload
        let textOutput = '';
        if (session.moduleType === 'WEBSITE') {
            textOutput = result.response;
        } else {
            textOutput = result.question;
        }

        // Save AI question to transcript memory (since the turn advances next)
        await saveTranscript(sessionId, session.turnCount, SPEAKERS.AI, textOutput);

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                aiResponse: textOutput,
                turnCount: session.turnCount
            })
        };
    } catch (err) {
        console.error('generateQuestion failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
