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

const IRRELEVANT_PATTERNS = [
  /\b(weather|movie|game|sports|football|cricket|food|restaurant|hobby|pet|dog|cat)\b/i,
  /\b(let me tell you a joke|funny story|by the way|random thought)\b/i,
];

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
// PROMPT BUILDERS (Professional Rewrite)
// =============================================================================

/**
 * RESUME INTERVIEW
 * AI acts as a technical interviewer asking questions based on the candidate's resume.
 * Professional, focused, no small talk.
 */
function buildInterviewPrompt(resumeData, turnIndex, conversationHistory = [], aiName = 'Emma', relevance = null, currentDimension = 'their past experience') {
  const summary = extractResumeSummary(resumeData);
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  let turnInstruction = isFirstTurn 
    ? `\n<turn_instruction>\nThis is the very first turn. Begin with a concise, professional greeting: state your name and that you are the interviewer from Qlue. Immediately follow with your first question about the candidate's background or experience. \n\nSTRICTLY FORBIDDEN opening phrases: "excited to chat", "happy to chat", "happy to talk", "how are you doing today", "how is your day going", "great to meet you", "lovely to speak with you", "nice to meet you", or any small-talk filler.\n</turn_instruction>` 
    : '';

  if (relevance && relevance.issue === 'too_short') {
    turnInstruction = `\n<turn_instruction>\nThe candidate gave a very brief response. Ask a concise follow-up that encourages them to elaborate with more detail before moving on.\n</turn_instruction>`;
  } else if (relevance && relevance.issue === 'irrelevant_topic') {
    turnInstruction = `\n<turn_instruction>\nThe candidate went off-topic. Politely but firmly guide them back to professional topics relevant to the role.\n</turn_instruction>`;
  }

  return `You are ${aiName}, an expert Technical Interviewer from Qlue.

<candidate_resume>
${summary}
</candidate_resume>

<core_personality>
- You are professional, direct, and respectful.
- You listen actively and react naturally to what the candidate says.
- You NEVER say generic filler like "thank you for sharing", "thanks for that", "that's happy to know about you", "great answer", "good to know", "interesting", "fascinating".
- You NEVER thank the candidate for their time until the very end of the interview (which is not now).
- You NEVER use emojis.
- You NEVER engage in small talk or ask about the candidate's well-being, mood, or day.
</core_personality>

<response_rules>
1. ALWAYS structure your response in two parts: an acknowledgment, followed by a question.
2. FORMAT REQUIREMENT: Separate the two parts using exactly " || ". Do not output literal words like "Acknowledgment:" or "Question:".
3. Your acknowledgment must be exactly ONE concise sentence reacting to their last answer. If this is the first turn, skip the acknowledgment and only output the question (no "||" needed).
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

/**
 * WEBSITE MODULE
 * AI acts as a tutor asking questions based on content from a link the user shared.
 * Engaging but focused on teaching concepts from the source material.
 */
function buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, an expert Tutor from Qlue.

<source_material>
${websiteContent?.substring(0, 1500) || 'Content not available'}
</source_material>

<core_personality>
- You are clear, encouraging, and focused on teaching.
- You react exactly like a real human tutor (e.g., "Exactly!" or "Not quite, but good try!").
- You NEVER say generic filler like "thank you for sharing", "thanks for your time", "great answer", "good to know".
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

${isFirstTurn ? `\n<turn_instruction>\nStart with a brief, welcoming greeting and immediately ask your first question about ${targetConcept}. Do not use phrases like "excited to chat", "happy to talk", or any small-talk filler.\n</turn_instruction>` : ''}

Respond with ONLY what ${aiName} says using the || format.`;
}

/**
 * HR INTERVIEW
 * AI acts as an HR interviewer asking situational and behavioral questions.
 * Warm but professional, focused on culture fit and teamwork.
 */
function buildHrPrompt(userData, turnIndex, conversationHistory = [], aiName = 'Emma', relevance = null) {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  let turnInstruction = isFirstTurn 
    ? `\n<turn_instruction>\nStart with a brief, professional greeting using their name, then ask a direct behavioral or situational HR question. Do not use phrases like "excited to chat", "happy to talk", "how are you doing today", "how is your day going", "great to meet you", "lovely to speak with you", or any small-talk filler.\n</turn_instruction>` 
    : '';

  if (relevance && relevance.issue === 'too_short') {
    turnInstruction = `\n<turn_instruction>\nThe candidate gave a very brief response. Ask a concise follow-up that encourages them to elaborate with more detail.\n</turn_instruction>`;
  } else if (relevance && relevance.issue === 'irrelevant_topic') {
    turnInstruction = `\n<turn_instruction>\nThe candidate went off-topic. Politely guide them back to professional topics.\n</turn_instruction>`;
  }

  return `You are ${aiName}, a professional HR Interviewer from Qlue.

<candidate_info>
${userData?.name ? `Name: ${userData.name}` : 'Name: Candidate'}
${userData?.currentRole ? `Current Role: ${userData.currentRole}` : ''}
</candidate_info>

<core_personality>
- You are warm but professional. You put people at ease without being overly casual.
- You react naturally to their answers (e.g., "That sounds like a valuable experience.").
- You NEVER say generic filler like "thank you for sharing", "thanks for your time", "great answer", "good to know", "interesting".
- You NEVER use emojis.
- You NEVER engage in small talk about their day, mood, or well-being.
</core_personality>

<response_rules>
1. ALWAYS structure your response in two parts: a natural reaction, followed by your behavioral question.
2. FORMAT REQUIREMENT: Separate the two parts using exactly " || ".
3. Ask exactly ONE engaging behavioral or situational question (teamwork, culture fit, conflict resolution, leadership, handling pressure).
4. Base your follow-up heavily on their previous answer.
5. Keep your total response maximum 3 short sentences.
</response_rules>

<conversation_history>
${historyText || '(This is the beginning of the interview)'}
</conversation_history>${turnInstruction}

Respond with ONLY what ${aiName} says using the || format.`;
}

/**
 * SELF-INTRO MODULE
 * AI acts as a career coach/tutor. First asks "Tell me about yourself", 
 * then based on the user's response gives suggestions on what to include.
 */
function buildIntroPrompt(turnIndex, conversationHistory = [], aiName = 'Emma') {
  const historyText = formatConversationHistory(conversationHistory, aiName);
  const isFirstTurn = turnIndex === 0;

  return `You are ${aiName}, a highly supportive career coach from Qlue helping a candidate perfect their self-introduction for interviews.

<core_personality>
- You are supportive, constructive, and efficient.
- You give actionable, specific advice — not vague praise.
- You NEVER say generic filler like "thank you for sharing", "thanks for your time", "great answer", "good to know", "interesting".
- You NEVER use emojis.
</core_personality>

<response_rules>
1. ALWAYS structure your response in two parts: your feedback/acknowledgment, followed by your next question or instruction.
2. FORMAT REQUIREMENT: Separate the two parts using exactly " || ".
3. Keep your total response maximum 3 short sentences.
4. Give extremely concise, high-impact feedback. Focus on what is MISSING or what should be ADDED.
</response_rules>

<conversation_history>
${historyText || '(This is the beginning of the session)'}
</conversation_history>

<turn_instruction>
${isFirstTurn 
  ? 'Directly ask the candidate: "Tell me about yourself." No small talk, no casual greetings, no filler.' 
  : (turnIndex === 1 
      ? 'Analyze their introduction carefully. Give ONE highly specific, constructive tip on what they should include or improve (e.g., "Add your years of experience", "Mention a key achievement with metrics", "Connect your background to the target role"). Then ask ONE follow-up question to help them refine their intro.' 
      : 'Continue coaching. Dig deeper into a specific aspect of their introduction. Either suggest another missing element, ask them to rephrase a weak part, or have them practice a specific component (e.g., opening hook, closing statement).')}
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