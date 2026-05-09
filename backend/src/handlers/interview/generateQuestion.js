const { invokeModel } = require('../../lib/bedrock');
// BE-BUG #24 FIX: Use BEDROCK_MODEL_ID env var — was hardcoded to wrong model
const DEFAULT_BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'nvidia.nemotron-super-3-120b';

// BE-BUG #8 FIX: Map voice IDs to human-sounding persona names
// so the AI doesn't introduce itself as a voice name like 'Tiffany'
const VOICE_PERSONA_MAP = {
  'Tiffany': 'Emma',
  'Ruth': 'Rachel',
  'Joanna': 'Sarah',
  'Matthew': 'Chris',
  'Stephen': 'Steve',
};

function getAiPersona(voiceId) {
  return VOICE_PERSONA_MAP[voiceId] || 'Alex';
}

// =============================================================================
// RESUME SUMMARY EXTRACTION
// =============================================================================
function extractResumeSummary(resumeData) {
  if (!resumeData) return 'No resume data available.';

  const r = resumeData.parsedData || resumeData;

  const name = r.name || r.fullName || 'Candidate';
  const title = r.title || r.jobTitle || r.headline || '';
  const summary = r.summary || r.professionalSummary || '';

  const skills = Array.isArray(r.skills)
    ? r.skills.slice(0, 8).join(', ')
    : (typeof r.skills === 'string' ? r.skills : '');

  const experiences = [];
  if (Array.isArray(r.experience)) {
    for (const exp of r.experience.slice(0, 3)) {
      const role = exp.title || exp.role || exp.position || '';
      const company = exp.company || exp.companyName || '';
      const achievements = Array.isArray(exp.achievements)
        ? exp.achievements.slice(0, 2).join('; ')
        : (exp.description || '').substring(0, 150);
      if (role && company) {
        experiences.push(`- ${role} at ${company}${achievements ? `: ${achievements}` : ''}`);
      }
    }
  }

  const projects = [];
  if (Array.isArray(r.projects)) {
    for (const proj of r.projects.slice(0, 2)) {
      const name = proj.name || proj.title || '';
      const desc = proj.description || proj.summary || '';
      const tech = Array.isArray(proj.technologies) ? proj.technologies.join(', ') : (proj.tech || '');
      if (name) {
        projects.push(`- ${name}${tech ? ` (${tech})` : ''}${desc ? `: ${desc.substring(0, 100)}` : ''}`);
      }
    }
  }

  return `Name: ${name}
${title ? `Title: ${title}` : ''}
${summary ? `Summary: ${summary.substring(0, 200)}` : ''}
${skills ? `Top Skills: ${skills}` : ''}
${experiences.length ? `Experience:\n${experiences.join('\n')}` : ''}
${projects.length ? `Projects:\n${projects.join('\n')}` : ''}`;
}

// =============================================================================
// CONVERSATION HISTORY FORMATTER
// =============================================================================
function formatConversationHistory(transcripts, aiName = 'AI') {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return '';

  return transcripts
    // 🔴 FIX: Sort by turnIndex AND timestamp to keep history in chronological order
    .sort((a, b) => {
      const turnDiff = (a.turnIndex || 0) - (b.turnIndex || 0);
      if (turnDiff !== 0) return turnDiff;
      return new Date(a.timestamp) - new Date(b.timestamp);
    })
    .map(t => {
      const speaker = t.speaker === 'AI' ? `${aiName} (Interviewer)` : 'Candidate';
      const safeText = (t.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `${speaker}: ${safeText}`;
    })
    .join('\n');
}

// =============================================================================
// INTERVIEW PROMPT BUILDER
// =============================================================================
function buildInterviewPrompt(resumeData, turnIndex, conversationHistory = [], moduleType = 'RESUME', aiName = 'Emma') {
  const summary = extractResumeSummary(resumeData);
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  const lastCandidateMessage = conversationHistory
    .filter(t => t.speaker !== 'AI')
    .pop();
  const exitPhrases = ['thank you', 'i\'m done', 'that\'s all', 'no more', 'goodbye', 'bye', 'end'];
  const wantsToExit = lastCandidateMessage &&
    exitPhrases.some(p => lastCandidateMessage.text?.toLowerCase().includes(p));

  if (wantsToExit) {
    return `You are ${aiName}, a warm, cheerful, and professional interviewer from Qlue.

CONVERSATION HISTORY:
${historyText}

The candidate seems ready to end the interview. Give a brief, warm wrap-up:
- Thank them sincerely for their time and energy
- Mention one specific thing you loved about the conversation
- Wish them well with a cheerful tone
- Keep it under 30 words

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
  }

  return `You are ${aiName}, a warm, cheerful, and highly realistic Technical Interviewer from Qlue.

CANDIDATE RESUME:
${summary}

${historyText ? `=== CONVERSATION HISTORY ===
${historyText}` : '(This is the beginning of the interview)'}

=== INSTRUCTIONS (HIGHEST PRIORITY) ===
${isFirstTurn ? `- Start with an energetic, warm greeting like "Hi, I'm ${aiName}! I'm so excited to chat with you today." and ask them to introduce themselves or kick off with a general resume question.` : '- Act exactly like a real Technical Interviewer. Listen to what the user just said.'}
- Your questions must strictly be based either on the user's PREVIOUS ANSWER (follow-up questions diving deeper into the technical details they just mentioned) OR based on specific details found in their CANDIDATE RESUME.
- Be warm and cheerful but remain highly technical.
- Ask exactly ONE focused question.
- Keep your entire response under 40 words.

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
}

// =============================================================================
// WEBSITE MODULE PROMPT
// =============================================================================
function buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, an actual, expert Tutor from Qlue teaching a student based on the provided website content.

WEBSITE CONTENT:
${websiteContent?.substring(0, 1500) || 'Content not available'}

${historyText ? `CONVERSATION SO FAR:
${historyText}` : ''}

INSTRUCTIONS:
${isFirstTurn ? '- Start with a very energetic, welcoming greeting and ask them an initial question about the website content.' : '- Act like a real tutor evaluating their previous answer.'}
- If their last answer was CORRECT: explicitly praise them (e.g., "Good work!", "Keep it up!", "Exactly!"), and then ask a NEW question with INCREASED difficulty based on the website content.
- If their last answer was WRONG or incomplete: explicitly correct them right there, guide them to the right answer like an actual tutor explaining the concept, and then ask a follow-up question to ensure they understand.
- Ask exactly ONE question.
- Keep under 50 words. Be encouraging, educational, and act like a real human tutor.

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
}

// =============================================================================
// HR MODULE PROMPT
// =============================================================================
function buildHrPrompt(userData, turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, a fun, warm, cheerful, and professional HR Interviewer from Qlue. You love getting to know candidates on a personal level!

CANDIDATE INFO:
${userData?.name ? `Name: ${userData.name}` : ''}
${userData?.currentRole ? `Current Role: ${userData.currentRole}` : ''}

${historyText ? `CONVERSATION SO FAR:
${historyText}` : ''}

INSTRUCTIONS:
${isFirstTurn ? '- Start with an incredibly warm, friendly greeting to put them at ease and ask them a general behavioral HR question.' : '- Transition naturally. React to what they just said exactly like a real human HR person would (e.g., "That sounds like a great experience!", "I love that approach!").'}
- Ask exactly ONE engaging behavioral-oriented question (how they handle situations, teamwork, culture fit, etc).
- Base your follow-up heavily on their previous answer to make it feel like a real HR conversation.
- Keep the vibe fun, warm, cheerful, and not like a rigid checklist.
- Keep under 35 words.

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
}

// =============================================================================
// INTRO MODULE PROMPT
// =============================================================================
function buildIntroPrompt(turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, a warm, cheerful, and highly supportive career coach from Qlue helping a candidate perfect their self-introduction.

${historyText ? `CONVERSATION SO FAR:
${historyText}` : ''}

INSTRUCTIONS:
${isFirstTurn 
  ? '- Cheerfully ask the user to give their self-introduction.'
  : '- The user has just given their self-introduction. You must analyze it immediately.'}
${!isFirstTurn ? '- Give them direct, constructive feedback right now (e.g., "Good job, but you can add a few more points about your recent projects" or "That was excellent, very clear!").' : ''}
${!isFirstTurn ? '- After giving feedback, politely conclude the exercise (e.g., "That wraps up our self-intro practice!").' : ''}
- Do NOT ask them another question if you are giving feedback. Conclude it.
- Keep under 50 words.

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
}

// =============================================================================
// RESPONSE CLEANER
// =============================================================================
function cleanAIResponse(rawText) {
  if (!rawText) return '';

  let cleaned = rawText.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.question) cleaned = parsed.question;
    else if (parsed.response) cleaned = parsed.response;
    else if (parsed.text) cleaned = parsed.text;
    else if (parsed.message) cleaned = parsed.message;
  } catch (e) {
    // Not JSON
  }

  cleaned = cleaned
    .replace(/^Emma:\s*/i, '')
    .replace(/^Interviewer:\s*/i, '')
    .replace(/^AI:\s*/i, '')
    .replace(/^Question:\s*/i, '')
    .replace(/^Response:\s*/i, '')
    .replace(/^\*\*.*?\*\*:\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  cleaned = cleaned
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*{[^}]*}\s*/g, ' ');

  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================
exports.handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    const { sessionId, moduleType, resumeData, websiteContent, targetConcept, userData, turnIndex, conversationHistory, voiceId } = body;

    // BE-BUG #8 FIX: Use persona map instead of voiceId as AI name
    const aiName = getAiPersona(voiceId);

    let prompt;
    switch (moduleType) {
      case 'WEBSITE':
        prompt = buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory, aiName);
        break;
      case 'HR':
        prompt = buildHrPrompt(userData, turnIndex, conversationHistory, aiName);
        break;
      case 'INTRO':
        prompt = buildIntroPrompt(turnIndex, conversationHistory, aiName);
        break;
      case 'RESUME':
      default:
        prompt = buildInterviewPrompt(resumeData, turnIndex, conversationHistory, moduleType, aiName);
        break;
    }

    let rawResponse = '';
    const namePrefixRegex = new RegExp(`^${aiName}:\\s*`, 'i');

    if (body.onToken) {
        const { invokeModelStream } = require('../../lib/bedrock');
        rawResponse = await invokeModelStream(DEFAULT_BEDROCK_MODEL_ID, {
            messages: [{ role: 'user', content: [{ text: prompt }] }]
        }, (token) => {
            let cleanedToken = token.replace(namePrefixRegex, '');
            body.onToken(cleanedToken);
        });
    } else {
        const result = await invokeModel(DEFAULT_BEDROCK_MODEL_ID, {
            messages: [{ role: 'user', content: [{ text: prompt }] }]
        });
        rawResponse = result.content?.[0]?.text || '';
    }

    let cleanedResponse = cleanAIResponse(rawResponse);
    cleanedResponse = cleanedResponse.replace(namePrefixRegex, '');

    return {
      statusCode: 200,
      body: JSON.stringify({
        question: cleanedResponse
      })
    };
  } catch (error) {
    console.error('Generate Question Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

module.exports = {
  handler: exports.handler,
  buildInterviewPrompt,
  buildWebsiteTeachPrompt,
  buildHrPrompt,
  buildIntroPrompt,
  cleanAIResponse,
  extractResumeSummary
};