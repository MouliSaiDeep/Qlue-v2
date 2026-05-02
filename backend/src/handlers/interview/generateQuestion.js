const { invokeModel } = require('../../lib/bedrock');

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
function formatConversationHistory(transcripts) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) return '';
  
  return transcripts
    .sort((a, b) => (a.turnIndex || 0) - (b.turnIndex || 0))
    .map(t => {
      const speaker = t.speaker === 'AI' ? 'Emma (Interviewer)' : 'Candidate';
      return `${speaker}: ${t.text || ''}`;
    })
    .join('\n');
}

// =============================================================================
// INTERVIEW PROMPT BUILDER
// =============================================================================
function buildInterviewPrompt(resumeData, turnIndex, conversationHistory = [], moduleType = 'RESUME') {
  const summary = extractResumeSummary(resumeData);
  const historyText = formatConversationHistory(conversationHistory);
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
    return `You are Emma, a warm and professional interviewer from Qlue.

CONVERSATION HISTORY:
${historyText}

The candidate seems ready to end the interview. Give a brief, warm wrap-up:
- Thank them sincerely for their time
- Mention one specific thing you appreciated from the conversation
- Wish them well
- Keep it under 30 words

Respond with ONLY what Emma says. No labels, no JSON.`;
  }

  return `You are Emma, a friendly and professional interviewer from Qlue conducting a voice interview.

CANDIDATE RESUME:
${summary}

${historyText ? `CONVERSATION SO FAR:
${historyText}` : '(This is the beginning of the interview)'}

INSTRUCTIONS:
${isFirstTurn ? '- Start with a warm, brief greeting like "Hi, I\'m Emma from Qlue. Great to meet you!"' : '- ALWAYS acknowledge their previous answer in 1 short sentence before asking the next question'}
- Ask exactly ONE focused question about ${currentDimension}
- The question must reference SPECIFIC details from their resume — NEVER ask generic "what is X" definitions
- Keep your entire response under 25 words
- Be conversational and warm, not robotic
- If they gave a vague answer, politely ask for a specific example

BAD EXAMPLE: "Can you explain what React is?"
GOOD EXAMPLE: "You built a real-time chat app at TechCorp — what was the hardest scaling challenge?"

Respond with ONLY what Emma says. No labels, no JSON, no stage directions.`;
}

// =============================================================================
// WEBSITE MODULE PROMPT
// =============================================================================
function buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory = []) {
  const historyText = formatConversationHistory(conversationHistory);
  const isFirstTurn = turnIndex === 0;

  return `You are Emma, a friendly teacher from Qlue helping a student learn about ${targetConcept}.

WEBSITE CONTENT:
${websiteContent?.substring(0, 1500) || 'Content not available'}

${historyText ? `CONVERSATION SO FAR:
${historyText}` : ''}

INSTRUCTIONS:
${isFirstTurn ? '- Start with a warm greeting' : '- Acknowledge their previous response briefly'}
- Teach one small, focused concept at a time
- Ask exactly ONE follow-up question to check understanding
- Keep under 25 words
- Be encouraging and warm

Respond with ONLY what Emma says. No labels, no JSON.`;
}

// =============================================================================
// HR MODULE PROMPT
// =============================================================================
function buildHrPrompt(userData, turnIndex, conversationHistory = []) {
  const historyText = formatConversationHistory(conversationHistory);
  const isFirstTurn = turnIndex === 0;
  
  const hrTopics = [
    'career goals and aspirations',
    'strengths and areas for growth',
    'handling conflict or pressure',
    'leadership and initiative',
    'why they want this role'
  ];
  const topic = hrTopics[turnIndex % hrTopics.length];

  return `You are Emma, a friendly HR interviewer from Qlue.

CANDIDATE INFO:
${userData?.name ? `Name: ${userData.name}` : ''}
${userData?.currentRole ? `Current Role: ${userData.currentRole}` : ''}

${historyText ? `CONVERSATION SO FAR:
${historyText}` : ''}

INSTRUCTIONS:
${isFirstTurn ? '- Start with a warm greeting' : '- Acknowledge their previous answer briefly'}
- Ask exactly ONE behavioral question about ${topic}
- Keep under 25 words
- Be warm and professional

Respond with ONLY what Emma says. No labels, no JSON.`;
}

// =============================================================================
// INTRO MODULE PROMPT
// =============================================================================
function buildIntroPrompt(turnIndex, conversationHistory = []) {
  const historyText = formatConversationHistory(conversationHistory);
  const isFirstTurn = turnIndex === 0;

  return `You are Emma, a friendly interviewer from Qlue helping a candidate practice self-introductions.

${historyText ? `CONVERSATION SO FAR:
${historyText}` : ''}

INSTRUCTIONS:
${isFirstTurn ? '- Ask them to give a 1-minute self-introduction' : '- Give brief feedback on their introduction, then ask one follow-up about something they mentioned'}
- Keep under 25 words
- Be encouraging

Respond with ONLY what Emma says. No labels, no JSON.`;
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
    const body = JSON.parse(event.body || '{}');
    const { sessionId, moduleType, resumeData, websiteContent, targetConcept, userData, turnIndex, conversationHistory } = body;

    let prompt;
    switch (moduleType) {
      case 'WEBSITE':
        prompt = buildWebsiteTeachPrompt(websiteContent, targetConcept, turnIndex, conversationHistory);
        break;
      case 'HR':
        prompt = buildHrPrompt(userData, turnIndex, conversationHistory);
        break;
      case 'INTRO':
        prompt = buildIntroPrompt(turnIndex, conversationHistory);
        break;
      case 'RESUME':
      default:
        prompt = buildInterviewPrompt(resumeData, turnIndex, conversationHistory, moduleType);
        break;
    }

    const result = await invokeModel(null, {
      messages: [{ role: 'user', content: [{ text: prompt }] }]
    });
    const rawResponse = result.content?.[0]?.text || '';
    const cleanedResponse = cleanAIResponse(rawResponse);

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
