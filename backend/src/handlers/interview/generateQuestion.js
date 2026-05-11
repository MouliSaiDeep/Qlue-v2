const { invokeModel } = require('../../lib/bedrock');

// BE-BUG #24 FIX: Use BEDROCK_MODEL_ID env var — was hardcoded to wrong model
const DEFAULT_BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID;

// BE-BUG #8 FIX: Map voice IDs to human-sounding persona names
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
// RELEVANCE & EXIT CHECKING (Ported from Python)
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

const IRRELEVANT_PATTERNS = [
  /\b(weather|movie|game|sports|football|cricket|food|restaurant|hobby|pet|dog|cat)\b/i,
  /\b(let me tell you a joke|funny story|by the way|random thought)\b/i,
];

function checkExitIntent(transcript) {
  if (!transcript) return false;
  return EXIT_INTENT_PATTERNS.some(pattern => pattern.test(transcript));
}

function analyzeResponseRelevance(transcript) {
  if (!transcript || transcript.trim() === '') return { isRelevant: true, issue: null };
  
  const wordCount = transcript.trim().split(/\s+/).length;
  if (wordCount < 5) return { isRelevant: false, issue: 'too_short' };

  for (const pattern of IRRELEVANT_PATTERNS) {
    if (pattern.test(transcript)) {
      return { isRelevant: false, issue: 'irrelevant_topic' };
    }
  }

  return { isRelevant: true, issue: null };
}

// =============================================================================
// DATA FORMATTERS
// =============================================================================
function extractResumeSummary(resumeData) {
  if (!resumeData) return 'No resume data available.';
  const r = resumeData.parsedData || resumeData;

  const name = r.name || r.fullName || 'Candidate';
  const title = r.title || r.jobTitle || r.headline || '';
  const summary = r.summary || r.professionalSummary || '';
  const skills = Array.isArray(r.skills) ? r.skills.slice(0, 8).join(', ') : (typeof r.skills === 'string' ? r.skills : '');

  const experiences = [];
  if (Array.isArray(r.experience)) {
    for (const exp of r.experience.slice(0, 3)) {
      const role = exp.title || exp.role || exp.position || '';
      const company = exp.company || exp.companyName || '';
      const achievements = Array.isArray(exp.achievements) ? exp.achievements.slice(0, 2).join('; ') : (exp.description || '').substring(0, 150);
      if (role && company) experiences.push(`- ${role} at ${company}${achievements ? `: ${achievements}` : ''}`);
    }
  }

  const projects = [];
  if (Array.isArray(r.projects)) {
    for (const proj of r.projects.slice(0, 2)) {
      const name = proj.name || proj.title || '';
      const desc = proj.description || proj.summary || '';
      const tech = Array.isArray(proj.technologies) ? proj.technologies.join(', ') : (proj.tech || '');
      if (name) projects.push(`- ${name}${tech ? ` (${tech})` : ''}${desc ? `: ${desc.substring(0, 100)}` : ''}`);
    }
  }

  return `Name: ${name}
${title ? `Title: ${title}` : ''}
${summary ? `Summary: ${summary.substring(0, 200)}` : ''}
${skills ? `Top Skills: ${skills}` : ''}
${experiences.length ? `Experience:\n${experiences.join('\n')}` : ''}
${projects.length ? `Projects:\n${projects.join('\n')}` : ''}`;
}

function formatConversationHistory(transcripts, aiName = 'AI') {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return '';
  return transcripts
    .sort((a, b) => {
      const turnDiff = (a.turnIndex || 0) - (b.turnIndex || 0);
      return turnDiff !== 0 ? turnDiff : new Date(a.timestamp) - new Date(b.timestamp);
    })
    .map(t => {
      const speaker = t.speaker === 'AI' ? `${aiName} (Interviewer)` : 'Candidate';
      const safeText = (t.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `${speaker}: ${safeText}`;
    }).join('\n');
}

// =============================================================================
// PROMPT BUILDERS (XML + Relevance Architecture)
// =============================================================================
function buildInterviewPrompt(resumeData, turnIndex, conversationHistory = [], aiName = 'Emma', relevance = null, currentDimension = 'their past experience') {
  const summary = extractResumeSummary(resumeData);
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  const wantsToExit = conversationHistory.length > 0 && checkExitIntent(conversationHistory[conversationHistory.length - 1].text);

  if (wantsToExit) {
    return `You are ${aiName}, a warm, professional interviewer from Qlue.
<conversation_history>\n${historyText}\n</conversation_history>
The candidate seems ready to end the interview. Wrap up warmly:
- Thank them sincerely for their time.
- Mention one specific thing you loved about the chat.
- Keep it under 2 short sentences.
- NEVER use emojis.
Output exactly what you will say. No labels.`;
  }

  let turnInstruction = isFirstTurn 
    ? `\n<turn_instruction>\nStart with an energetic greeting like "Hi, I'm ${aiName} from Qlue! I'm excited to chat with you today." followed by your first question.\n</turn_instruction>` 
    : '';

  if (relevance && relevance.issue === 'too_short') {
    turnInstruction = `\n<turn_instruction>\nThe candidate gave a very brief response. Cheerfully encourage them to elaborate before asking your next question.\n</turn_instruction>`;
  } else if (relevance && relevance.issue === 'irrelevant_topic') {
    turnInstruction = `\n<turn_instruction>\nThe candidate went off-topic. Gently and politely guide them back to professional topics.\n</turn_instruction>`;
  }

  return `You are ${aiName}, an expert Technical Interviewer from Qlue.

<candidate_resume>
${summary}
</candidate_resume>

<core_personality>
- You are professional, highly realistic, warm, and approachable.
- You listen actively and react naturally to what the candidate says.
- You NEVER say generic filler like "thank you for sharing".
- You NEVER use emojis.
</core_personality>

<response_rules>
1. ALWAYS structure your response in two parts: an acknowledgment, followed by a question.
2. FORMAT REQUIREMENT: Separate the two parts using exactly " || ". Do not output literal words like "Acknowledgment:" or "Question:".
3. Your acknowledgment must be exactly ONE concise sentence reacting to their last answer.
4. Ask exactly ONE focused question about ${currentDimension} OR dig deeper into their last response.
5. NEVER ask multiple questions at once.
6. NEVER repeat questions from the history.
7. Keep your total response maximum 3 short sentences to ensure natural spoken pacing.
</response_rules>

<conversation_history>
${historyText || '(This is the beginning of the interview)'}
</conversation_history>${turnInstruction}

Respond with ONLY what ${aiName} says using the || format.`;
}

function buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, an expert, engaging Tutor from Qlue.

<source_material>
${websiteContent?.substring(0, 1500) || 'Content not available'}
</source_material>

<core_personality>
- You are encouraging, fun, and highly attentive.
- You evaluate answers gently but clearly.
- You NEVER use emojis.
</core_personality>

<response_rules>
1. ALWAYS structure your response in two parts: your feedback, followed by your next question.
2. FORMAT REQUIREMENT: Separate the two parts using exactly " || ".
3. If their last answer was incorrect/inefficient: cheerfully correct them, provide a concise explanation, then move to the next concept.
4. If correct: praise them enthusiastically and ask a progressively harder follow-up.
5. Teach ONE small, focused concept at a time based on the <source_material>.
6. Keep your total response maximum 3 short sentences.
</response_rules>

<conversation_history>
${historyText || '(This is the beginning of the lesson)'}
</conversation_history>

${isFirstTurn ? `\n<turn_instruction>\nStart with a very energetic, welcoming greeting before asking your first question about ${targetConcept}.\n</turn_instruction>` : ''}

Respond with ONLY what ${aiName} says using the || format.`;
}

function buildHrPrompt(userData, turnIndex, conversationHistory = [], aiName = 'Emma', relevance = null) {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  let turnInstruction = isFirstTurn 
    ? `\n<turn_instruction>\nStart with an incredibly warm, friendly greeting using their name to put them at ease, then ask a general behavioral HR question.\n</turn_instruction>` 
    : '';

  if (relevance && relevance.issue === 'too_short') {
    turnInstruction = `\n<turn_instruction>\nThe candidate gave a very brief response. Cheerfully encourage them to elaborate before asking your next question.\n</turn_instruction>`;
  } else if (relevance && relevance.issue === 'irrelevant_topic') {
    turnInstruction = `\n<turn_instruction>\nThe candidate went off-topic. Gently and politely guide them back to professional topics.\n</turn_instruction>`;
  }

  return `You are ${aiName}, a fun, warm, and professional HR Interviewer from Qlue who loves getting to know candidates.

<candidate_info>
${userData?.name ? `Name: ${userData.name}` : 'Name: Candidate'}
${userData?.currentRole ? `Current Role: ${userData.currentRole}` : ''}
</candidate_info>

<core_personality>
- You are exceptionally friendly and put people at ease.
- You react exactly like a real human HR person (e.g., "That sounds like a great experience!").
- You NEVER use emojis.
</core_personality>

<response_rules>
1. ALWAYS structure your response in two parts: a natural reaction, followed by your behavioral question.
2. FORMAT REQUIREMENT: Separate the two parts using exactly " || ".
3. Ask exactly ONE engaging behavioral question (teamwork, culture fit, handling situations).
4. Base your follow-up heavily on their previous answer.
5. Keep your total response maximum 3 short sentences.
</response_rules>

<conversation_history>
${historyText || '(This is the beginning of the interview)'}
</conversation_history>${turnInstruction}

Respond with ONLY what ${aiName} says using the || format.`;
}

function buildIntroPrompt(turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, a highly supportive career coach from Qlue helping a candidate perfect their self-introduction.

<core_personality>
- You are incredibly supportive, constructive, and fun.
- You NEVER use emojis.
</core_personality>

<response_rules>
1. ALWAYS structure your response in two parts: your feedback/acknowledgment, followed by your next question.
2. FORMAT REQUIREMENT: Separate the two parts using exactly " || ".
3. Keep your total response maximum 3 short sentences. Give extremely concise feedback.
</response_rules>

<conversation_history>
${historyText || '(This is the beginning of the session)'}
</conversation_history>

<turn_instruction>
${isFirstTurn 
  ? 'Cheerfully ask them to give a brief self-introduction as if they were in a real interview.' 
  : (turnIndex === 1 
      ? 'Carefully analyze their introduction. Give them a highly efficient, constructive tip on how to improve it, suggest missing key points, or praise a strong intro. Then, ask ONE follow-up question based on what they said.' 
      : 'Continue naturally. Dig deeper into a specific interest or experience they mentioned with genuine curiosity.')}
</turn_instruction>

Respond with ONLY what ${aiName} says using the || format.`;
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

  // Join the forced '||' delimiter back into natural text for the TTS engine
  if (cleaned.includes('||')) {
    cleaned = cleaned.split('||').map(s => s.trim()).join(' ');
  }

  cleaned = cleaned
    .replace(/^(.*?):\s*/i, '') // Remove any prefix like "Emma:" or "Interviewer:"
    .replace(/^\*\*.*?\*\*:\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  // Strip stage directions or weird formatting
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ')
                   .replace(/\s*\[[^\]]*\]\s*/g, ' ')
                   .replace(/\s*\{[^}]*\}\s*/g, ' ');

  return cleaned.replace(/\s+/g, ' ').trim();
}

// =============================================================================
// MAIN HANDLER
// =============================================================================
exports.handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    const { sessionId, moduleType, resumeData, websiteContent, targetConcept, userData, turnIndex, conversationHistory, voiceId, currentDimension } = body;

    const aiName = getAiPersona(voiceId);

    // Grab the user's most recent statement for relevance analysis
    let userLatestTranscript = '';
    if (Array.isArray(conversationHistory)) {
        const lastUserTurn = conversationHistory.filter(t => t.speaker !== 'AI').pop();
        if (lastUserTurn) userLatestTranscript = lastUserTurn.text;
    }
    const relevance = analyzeResponseRelevance(userLatestTranscript);

    let prompt;
    switch (moduleType) {
      case 'WEBSITE':
        prompt = buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory, aiName);
        break;
      case 'HR':
        prompt = buildHrPrompt(userData, turnIndex, conversationHistory, aiName, relevance);
        break;
      case 'INTRO':
        prompt = buildIntroPrompt(turnIndex, conversationHistory, aiName);
        break;
      case 'RESUME':
      default:
        prompt = buildInterviewPrompt(resumeData, turnIndex, conversationHistory, aiName, relevance, currentDimension || 'their past experience');
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
  extractResumeSummary,
  analyzeResponseRelevance
};