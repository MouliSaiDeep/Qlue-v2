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

const EXIT_INTENT_PATTERNS = [
    /\bthank\s+(you|u)\b.*\b(interview|time|opportunity|chat|talk)\b/i,
    /\bthat\'?s?\s+(it|all|everything)\b/i,
    /\b(i\'?m?\s+)?done\b/i,
    /\b(i\s+)?(have\s+)?(to\s+)?go\b/i,
    /\bend\s+(the\s+)?interview\b/i,
    /\bwrap\s+(it\s+)?up\b/i,
    /\bno\s+(more\s+)?questions\b/i,
    /\b(i\s+)?(think\s+)?(we\'?re?\s+)?(good|finished|complete)\b/i,
    /\bappreciate\s+(your\s+)?time\b/i,
    /\bhave\s+a\s+(good|great)\s+day\b/i,
    /\bgoodbye\b/i,
    /\bbye\b/i
];

function checkExitIntent(transcript) {
    if (!transcript) return false;
    return EXIT_INTENT_PATTERNS.some(pattern => pattern.test(transcript));
}

function buildInterviewPrompt(resumeData, turnIndex, conversationHistory = [], moduleType = 'RESUME', aiName = 'Emma') {
  const summary = extractResumeSummary(resumeData);
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  const lastCandidateMessage = conversationHistory
    .filter(t => t.speaker !== 'AI')
    .pop();
  const wantsToExit = lastCandidateMessage && checkExitIntent(lastCandidateMessage.text);

  if (wantsToExit) {
    return `You are ${aiName}, a warm, cheerful, and professional interviewer from Qlue.

CONVERSATION HISTORY:
${historyText}

The candidate seems ready to end the interview. Give a brief, warm wrap-up:
- Thank them sincerely for their time and energy
- Mention one specific thing you loved about the conversation
- Wish them well with a cheerful tone
- Keep it under 30 words
- NEVER use emojis.

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
  }

  return `You are ${aiName}, a warm, cheerful, and highly realistic Technical Interviewer from Qlue.

CANDIDATE RESUME:
${summary}

${historyText ? `=== CONVERSATION HISTORY ===
${historyText}` : '(This is the beginning of the interview)'}

=== INSTRUCTIONS (HIGHEST PRIORITY) ===
${isFirstTurn ? `- Start with an energetic, warm greeting like "Hi, I'm ${aiName} from Qlue! I'm so excited to chat with you today."` : '- Act like a real technical interviewer: dynamically follow up on their previous answer. If they mentioned a specific tech, ask why they chose it or what challenges they faced. NEVER say generic filler like "thank you for sharing".'}
- Keep the conversation highly interactive and fun.
- Ask exactly ONE focused question about ${currentDimension} OR dig deeper into their last response.
- MUST reference SPECIFIC details from their resume or past answers.
- Keep your entire response under 35 words.
- Be warm, conversational, and engaged.
- NEVER use emojis.
- ALWAYS format your response clearly as a short conversational acknowledgment followed by the question.

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
${isFirstTurn ? '- Start with a very energetic, welcoming greeting.' : '- Act like a real, attentive tutor. Evaluate their previous answer.'}
- If their last answer was incorrect or inefficient: cheerfully correct them and provide a concise, more efficient explanation, then move to the next concept.
- If they answered correctly: praise them enthusiastically and ask a progressively harder follow-up question related to the content.
- Teach one small, focused concept at a time based on the website content.
- Keep under 45 words. Be encouraging, fun, and warm.
- NEVER use emojis.
- ALWAYS format your response clearly as an evaluation/feedback followed by the follow-up question.

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
- NEVER use emojis.
- ALWAYS format your response clearly as a short acknowledgment followed by the behavioral question.

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
  ? '- Cheerfully ask them to give a brief self-introduction as if they were in a real interview.' 
  : (turnIndex === 1 
      ? '- Act like a real mentor. Carefully analyze their introduction. Give them a highly efficient, constructive tip on how to improve it, suggest missing key points, or praise a strong intro. Then, ask ONE follow-up question based on what they said.' 
      : '- Continue naturally. Dig deeper into a specific interest or experience they mentioned with genuine curiosity.')}
- Be incredibly supportive, constructive, and fun.
- Keep under 35 words. Give extremely concise feedback.
- NEVER use emojis.
- ALWAYS format your response clearly as your feedback/acknowledgment followed immediately by the follow-up question.

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

  // If the AI split it with '||' we just join it with a space or break
  if (cleaned.includes('||')) {
    cleaned = cleaned.split('||').map(s => s.trim()).join(' ');
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
    .replace(/\s*\{[^}]*\}\s*/g, ' ');

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