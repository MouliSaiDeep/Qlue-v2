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

  const dimensions = [
    'specific project or achievement from their resume',
    'technical depth and problem-solving approach',
    'work experience and career progression',
    'challenges faced and how they overcame them',
    'collaboration and teamwork'
  ];
  const currentDimension = dimensions[turnIndex % dimensions.length];

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

  return `You are ${aiName}, a warm, cheerful, and highly interactive technical interviewer from Qlue.

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

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
}

// =============================================================================
// WEBSITE MODULE PROMPT
// =============================================================================
function buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, a warm, cheerful, and highly effective tutor from Qlue helping a student master ${targetConcept}.

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

Respond with ONLY what ${aiName} says. No labels, no JSON.`;
}

// =============================================================================
// HR MODULE PROMPT
// =============================================================================
function buildHrPrompt(userData, turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  const hrTopics = [
    'career goals and aspirations',
    'strengths and areas for growth',
    'handling conflict or pressure',
    'leadership and initiative',
    'why they want this role'
  ];
  const topic = hrTopics[turnIndex % hrTopics.length];

  return `You are ${aiName}, a fun, vibrant, and warm HR interviewer from Qlue. You love getting to know candidates on a personal level!

CANDIDATE INFO:
${userData?.name ? `Name: ${userData.name}` : ''}
${userData?.currentRole ? `Current Role: ${userData.currentRole}` : ''}

${historyText ? `CONVERSATION SO FAR:
${historyText}` : ''}

INSTRUCTIONS:
${isFirstTurn ? '- Start with an incredibly warm, friendly greeting to put them at ease.' : '- Transition naturally. React to what they just said like a real human HR person would (e.g., "That sounds like a great experience!" or "I love that approach!").'}
- Ask exactly ONE engaging behavioral question about ${topic}.
- Base your follow-up on their previous answer if possible.
- Keep the vibe conversational, fun, and not like a rigid checklist.
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
  ? '- Cheerfully ask them to give a brief self-introduction as if they were in a real interview.' 
  : (turnIndex === 1 
      ? '- Act like a real mentor. Carefully analyze their introduction. Give them a highly efficient, constructive tip on how to improve it, suggest missing key points, or praise a strong intro. Then, ask ONE follow-up question based on what they said.' 
      : '- Continue naturally. Dig deeper into a specific interest or experience they mentioned with genuine curiosity.')}
- Be incredibly supportive, constructive, and fun.
- Keep under 50 words so you have enough room to give great feedback.

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