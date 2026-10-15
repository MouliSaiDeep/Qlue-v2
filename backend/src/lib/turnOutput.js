const INTRO_CLOSING = 'Thank you for completing both introductions. Your practice is complete, and your feedback report is being prepared.';
const INTERVIEW_CLOSING = 'Thank you for your time. This interview is complete, and your feedback report is being prepared.';

function readGeneratedTurn(result) {
  if (!result || result.statusCode !== 200) throw new Error('Question generation failed; please retry this answer.');
  let body;
  try { body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body; }
  catch { throw new Error('Invalid question response body'); }
  if (!body || typeof body.question !== 'string' || body.question.trim().length < 5 || body.question.length > 10000) {
    throw new Error('Empty or invalid generated question');
  }
  // Leave room for delivery metadata and an audio URL inside a 32-KiB frame.
  // JSON escaping and UTF-8 bytes, rather than JS character count, govern size.
  if(Buffer.byteLength(JSON.stringify(body.question),'utf8')>24000) throw new Error('Generated question exceeds the encoded delivery limit');
  if (body.expectsAnswer !== undefined && typeof body.expectsAnswer !== 'boolean') throw new Error('Invalid expectsAnswer');
  return body;
}

// A model's statement of intent is insufficient: invitations without a question
// mark ("please repeat") still require an answer. Closing is deterministic in
// application code, independent of model behavior.
function closingText(isIntro) { return isIntro ? INTRO_CLOSING : INTERVIEW_CLOSING; }
module.exports = { readGeneratedTurn, closingText };
