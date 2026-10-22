const diagnostics=require('../../lib/logger').safeConsole;
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { saveTranscript } = require('../../models/transcript');
// In-process worker capability: public JSON/API requests cannot forge Symbol
// properties. Recognition evidence was verified at WebSocket admission.
exports.ASR_EVIDENCE = Symbol('verifiedAsr');

const SILENCE_THRESHOLD = 5; // BE-BUG #5 FIX: was 3, too aggressive for interviews
const MAX_TURNS = 20;
const MAX_CLARIFICATIONS = 3;
const MAX_FRAGMENTS = 3;

function isClarification(text) {
  const value = String(text || '').toLowerCase().replace(/’/g, "'")
    .replace(/[,.!?;:]/g, ' ').trim().replace(/\s+/g, ' ');
  // Entire utterances only; mentioning these words in an answer is not control.
  return /^(?:(?:could|can|would) you (?:please )?|please )(?:repeat|rephrase)(?: the| your)? question(?: please)?$/.test(value)
    || /^my (?:microphone|mic|speech recognition|transcription) (?:is not|isn't|isnt) (?:taking|recognizing|recording|transcribing|working)(?: my (?:response|answer|speech))?(?: correctly| properly)?$/.test(value)
    || /^(?:(?:could|can|would) you (?:please )?|please )(?:say that again|repeat that)(?: please)?$/.test(value)
    || /^(?:sorry )?i (?:did not|didn't|could not|couldn't|cannot|can't) (?:hear|catch) (?:the|your) question$/.test(value);
}

// I-04: signal that the session moved on (terminated/advanced) during
// processing, so the worker must NOT generate a paid turn or deliver anything.
const ABORTED = Symbol('session-moved-on');

/**
 * Persist non-state fields while KEEPING the session in the state the worker
 * already claimed, CONDITIONAL on that state. The previous unconditional writes
 * (`updateSessionState(id, state, null, ...)`) could re-assert an in-flight
 * state over a session a concurrent terminate had just finished — reviving a
 * dead interview right before paid generation. Conditioning on the current
 * state makes that a no-op: returns the updated attributes, or ABORTED when the
 * row is no longer in the expected state.
 */
async function preserveStateWithUpdates(sessionId, currentState, updates) {
  try {
    return await updateSessionState(sessionId, currentState, currentState, updates);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return ABORTED;
    throw err;
  }
}

// BUG FIX: this used naive substring matching, so a candidate saying "we store
// it as a byte array" ('bye'), "I stopped using Redis" / "it runs nonstop"
// ('stop') or "that's all the traffic we handled" had their interview
// terminated mid-answer. Matching is now anchored on word boundaries, the
// ambiguous single words are gone, and the remaining phrases must be a
// standalone statement rather than a clause buried in a technical answer.
// Short, ambiguous phrases must close out the utterance — "That's all." ends an
// interview, "that's all the traffic we handled that quarter" does not.
const TERMINAL_EXIT_PATTERNS = [
  /\bi(?:'m| am) done\b\W*$/,
  /\bthat(?:'s| is) all\b\W*$/,
  /\bno more questions\b\W*$/,
  /\bgood ?bye\b\W*$/
];

// Explicit, unambiguous requests — safe to match anywhere in the utterance.
const EXPLICIT_EXIT_PATTERNS = [
  /\bend (?:the |this )?interview\b/,
  /\bstop (?:the |this )?interview\b/,
  /\bend (?:the |this )?session\b/,
  /\bfinish (?:the |this )?interview\b/
];

// Secondary guard: a genuine exit is short and deliberate, never a paragraph.
const MAX_EXIT_INTENT_WORDS = 15;

// I-09: a negation immediately before the exit phrase INVERTS the intent
// ("please don't end the interview", "I do not want to stop"). The offline
// probe reproduced such a sentence being treated as USER_EXIT. Detect a
// negator within a short window before the matched phrase and reject it.
const NEGATORS = /\b(?:not|n't|never|don't|do not|dont|please don't|please do not|didn't|won't|wouldn't|can't|cannot|without|no)\b/;

function isNegatedBefore(normalized, matchIndex) {
  // Look at the words in the ~6-word window preceding the exit phrase.
  const preceding = normalized.slice(0, matchIndex).split(/\s+/).slice(-6).join(' ');
  return NEGATORS.test(preceding);
}

function detectExitIntent(text) {
  if (!text) return false;
  const normalized = text.toLowerCase().trim();
  if (normalized.split(/\s+/).length > MAX_EXIT_INTENT_WORDS) return false;

  if (/["“”]/.test(normalized)) return false;
  for (const p of EXPLICIT_EXIT_PATTERNS) {
    const m = p.exec(normalized);
    if (m && !isNegatedBefore(normalized, m.index)) return true;
  }
  return false;
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { sessionId, textTranscript, isSilence, currentConceptId, lease = {} } = body;

    if (!sessionId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'sessionId required' }) };
    }

    const userId = event.requestContext?.authorizer?.uid;
    const session = await getSessionById(sessionId);
    if (!session) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
    }

    if (session.userId !== userId) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
    }

    const turnIndex = session.turnCount || 0;
    // Older clients without an ID still get a stable identity for this turn.
    const clientTurnId=body.clientTurnId||`legacy-${turnIndex}-${require('node:crypto').createHash('sha256').update(String(textTranscript||'')).digest('hex').slice(0,24)}`;

    // Handle silence
    if (isSilence) {
      const silenceRetries = (session.silenceRetries || 0) + 1;

      if (silenceRetries >= SILENCE_THRESHOLD) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            shouldTerminate: true,
            reason: 'SILENCE_TIMEOUT'
          })
        };
      }

      // I-01 / I-04: a silence re-prompt must NOT change the session state nor
      // consume a turn. The worker holds this turn in LOADING_CONTEXT and
      // generateAtomicTurn commits LOADING_CONTEXT -> AI_SPEAKING conditionally;
      // the old `-> SILENCE_DETECTED` move made that commit fail its condition,
      // so the "I didn't catch that" re-prompt was silently dropped and the
      // session wedged. Persist only the retry counter (conditional on the
      // current state so a concurrent terminate is never revived) and mark the
      // response as a re-prompt so the worker re-asks WITHOUT advancing the
      // turn count or the self-intro stage.
      const silenceUpdated = await preserveStateWithUpdates(sessionId, session.currentState, { silenceRetries, ...lease });
      if (silenceUpdated === ABORTED) {
        return { statusCode: 200, body: JSON.stringify({ aborted: true }) };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          shouldTerminate: false,
          nextAIResponse: "I didn't catch that. Could you please repeat?",
          silenceRetries,
          isReprompt: true,
          session: silenceUpdated || null
        })
      };
    }

    // Save user transcript
    const authoritativeAsr=event[exports.ASR_EVIDENCE];
    await saveTranscript(sessionId, turnIndex, 'USER', textTranscript, { eventId: clientTurnId, ...(authoritativeAsr?{asr:authoritativeAsr}:{}), ...lease });

    // Check exit intent
    if (detectExitIntent(textTranscript)) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          shouldTerminate: true,
          reason: 'USER_EXIT'
        })
      };
    }

    // A single recognition fragment is not a completed introduction. Preserve
    // it in the transcript, but do not consume the first/revised attempt.
    const isIntro = ['INTRO', 'SELF_INTRO'].includes(session.moduleType);
    const words = String(textTranscript || '').trim().split(/\s+/).filter(Boolean);
    if(require('../../lib/conversationRepair').isNameCorrection(textTranscript)) {
      const updated=await preserveStateWithUpdates(sessionId,session.currentState,{...lease});
      if(updated===ABORTED)return {statusCode:200,body:JSON.stringify({aborted:true})};
      // Re-ask the actual question after a correction; otherwise the repair
      // acknowledgment would replace the on-screen question. Strip any earlier
      // greeting/name from the prefix instead of repeating the recognition error.
      const question=typeof session.questionText==='string'
        ? session.questionText.match(/\b(?:could you|can you|what|how|why|when|where|which|tell me|describe|explain|walk me)\b[\s\S]*/i)?.[0] : null;
      return {statusCode:200,body:JSON.stringify({shouldTerminate:false,isReprompt:true,
        nextAIResponse:'Thank you for correcting me. '+(question||'Please continue with your answer to the current question.'),session:updated||null})};
    }
    if (isClarification(textTranscript)) {
      // Same durable receipt is not another clarification attempt.
      const retries = (session.clarificationRetries || 0)
        + (clientTurnId && session.clarificationId === clientTurnId ? 0 : 1);
      const unchanged = await preserveStateWithUpdates(sessionId, session.currentState, {
        clarificationRetries: retries, clarificationId: clientTurnId || null, ...lease
      });
      if (unchanged === ABORTED) return {statusCode:200,body:JSON.stringify({aborted:true})};
      return {statusCode:200,body:JSON.stringify({
        shouldTerminate: retries > MAX_CLARIFICATIONS,
        ...(retries > MAX_CLARIFICATIONS ? {reason:'CLARIFICATION_LIMIT'} : {}),
        isReprompt:true,
        nextAIResponse:isIntro
          ? 'Please give your introduction again when the microphone is ready. Your current introduction attempt is still open.'
          : 'Please repeat your answer when the microphone is ready. Your current question is still open.',
        session:unchanged || null
      })};
    }
    if (isIntro && words.length <= 1) {
      const ids = session.fragmentIds || [];
      const duplicate = clientTurnId && ids.includes(clientTurnId);
      const retries = Math.min(MAX_FRAGMENTS + 1, (session.fragmentRetries || 0) + (duplicate ? 0 : 1));
      const fragmentIds = !duplicate && clientTurnId && ids.length <= MAX_FRAGMENTS
        ? [...ids, clientTurnId] : ids;
      const unchanged = await preserveStateWithUpdates(sessionId, session.currentState, {
        fragmentRetries:retries, fragmentIds, ...lease
      });
      if (unchanged === ABORTED) {
        return { statusCode: 200, body: JSON.stringify({ aborted: true }) };
      }
      return { statusCode: 200, body: JSON.stringify({
        shouldTerminate: retries > MAX_FRAGMENTS, isReprompt: true,
        ...(retries > MAX_FRAGMENTS ? {reason:'RECOGNITION_RECOVERY_LIMIT'} : {}),
        nextAIResponse: retries > MAX_FRAGMENTS
          ? 'Speech recognition repeatedly returned only fragments. Your received text is saved; please restart when recognition is working.'
          : 'I only received a short fragment. Please repeat your full introduction so I can assess it.',
        session: unchanged || null
      }) };
    }
    // Check max turns
    if (turnIndex >= MAX_TURNS) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          shouldTerminate: true,
          reason: 'MAX_TURNS_REACHED'
        })
      };
    }

    // Preserve the current (claimed) session state while persisting concept
    // selection and resetting silence retries. CONDITIONAL on the current state
    // (I-04): if a concurrent terminate advanced the session during processing,
    // abort instead of reviving it into a paid turn.
    // PERF-FIX #5: return the ALL_NEW attributes so the async worker does not
    // need a second GetItem to see the updated session.
    // I-08: `incrementAnsweredCount` records a DURABLE count of accepted user
    // answers on the session row itself. terminateSession's discard-empty check
    // reads this instead of trusting the eventually-consistent transcripts GSI,
    // so a freshly-answered session is never discarded as "empty" merely because
    // its index has not caught up.
    const acceptedIds = session.acceptedAnswerIds || [];
    const duplicate = clientTurnId && (session.acceptedAnswerId === clientTurnId || acceptedIds.includes(clientTurnId));
    const updatedSession = await preserveStateWithUpdates(sessionId, session.currentState, {
      currentConceptId: currentConceptId || session.currentConceptId,
      silenceRetries: 0,
      clarificationRetries: 0,
      fragmentRetries: 0,
      fragmentIds: [],
      incrementAnsweredCount: !duplicate,
      // Bounded by MAX_TURNS; receipts remain the owner of stage/generation replay.
      acceptedAnswerIds: !duplicate && clientTurnId ? [...acceptedIds, clientTurnId].slice(-MAX_TURNS) : acceptedIds,
      acceptedAnswer: textTranscript,
      acceptedAnswerId: clientTurnId,
      ...(!duplicate && clientTurnId && body.audioExpected === true ? {answerAudioExpectedIds:[...(session.answerAudioExpectedIds || []),clientTurnId].slice(-MAX_TURNS)} : {}),
      ...(session.version !== undefined ? {expectedVersion:session.version} : {}),
      ...lease
    });
    if (updatedSession === ABORTED) {
      return { statusCode: 200, body: JSON.stringify({ aborted: true }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        shouldTerminate: false,
        nextAIResponse: null, // Will be generated by generateAtomicTurn
        // I-08: pass the just-accepted answer straight through to the worker so
        // generateAtomicTurn can seed it into the prompt directly. The context
        // read alone goes through the eventually-consistent GSI, so under index
        // lag the model could otherwise miss or misorder the latest answer.
        acceptedAnswer: textTranscript,
        acceptedTurnIndex: turnIndex,
        acceptedAsr: authoritativeAsr || null,
        session: updatedSession || null
      })
    };

  } catch (error) {
    diagnostics.error('Process User Input Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Exported for unit testing (I-09).
exports.detectExitIntent = detectExitIntent;
exports.isClarification = isClarification;
