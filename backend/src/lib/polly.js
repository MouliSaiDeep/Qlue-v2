const diagnostics=require('./logger').safeConsole;
const {beforePaidCall}=require('./paidWork');
const {sendBounded,remaining,bounded,streamBounded}=require('./deadline');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const pollyClient = new PollyClient({ maxAttempts: 1, region: process.env.AWS_REGION || 'us-east-1' });

// COST-FIX: Engines each voice supports, listed CHEAPEST FIRST.
// Polly pricing: standard $4/1M chars (5M/mo free), neural $16/1M (1M/mo free
// for 12 months), generative $30/1M (only 100K/mo free). The app previously
// forced 'generative' universally, which is why Polly was the second-largest
// line on the bill despite tiny usage.
const VOICE_ENGINE_SUPPORT = {
  'Tiffany': ['generative'],              // generative-only voice
  'Ruth': ['neural', 'generative'],
  'Joanna': ['neural', 'generative'],
  'Matthew': ['neural', 'generative'],
  'Stephen': ['neural', 'generative'],
  'Amy': ['standard', 'neural'],
  'Brian': ['standard', 'neural'],
  'Emma': ['neural'],
  'Arthur': ['neural']
};

// Neural-capable stand-in used when a generative-only voice is requested
// while cost-saver mode is active.
const COST_SAVER_VOICE = 'Ruth';

/**
 * Global launch policy. Premium voices remain locked for all accounts,
 * including old clients, stored preferences, and legacy environment opt-ins.
 */
function isGenerativeAllowed(allowGenerative) {
  return false; // Server-owned launch lock; even legacy sessions use neural.
}

/**
 * Resolve the (voice, engine) pair actually sent to Polly.
 * - Honours the requested engine when the voice supports it, else falls back
 *   to the cheapest engine that voice offers.
 * - Any generative-only selection resolves to Ruth/neural while Premium is
 *   locked. Existing standard voice choices remain available.
 *
 * @param {object} [options]
 * @param {boolean} [options.allowGenerative] per-request Premium opt-in.
 */
function resolveVoiceAndEngine(voiceId, requestedEngine, options = {}) {
  const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
  let voice = allowedVoices.includes(voiceId) ? voiceId : COST_SAVER_VOICE;

  const support = VOICE_ENGINE_SUPPORT[voice] || ['neural'];
  let engine = requestedEngine || process.env.POLLY_DEFAULT_ENGINE || 'neural';
  if (!support.includes(engine)) {
    engine = support[0]; // cheapest engine this voice offers
  }

  if (engine === 'generative' && !isGenerativeAllowed(options.allowGenerative)) {
    diagnostics.log(`[Polly] Cost-saver: substituting ${voice}/generative -> ${COST_SAVER_VOICE}/neural (use Premium voice mode or POLLY_ALLOW_GENERATIVE=true to opt in)`);
    voice = COST_SAVER_VOICE;
    engine = 'neural';
  }

  return { voice, engine };
}

// Engines tried, in order, when the requested one fails.
const ENGINE_FALLBACK_ORDER = ['generative', 'neural', 'standard'];

/**
 * @param {string} text
 * @param {string} voiceId
 * @param {string|null} requestedEngine
 * @param {object} [options]
 * @param {boolean} [options.allowGenerative] Premium opt-in for this request.
 * @param {string[]} [options._attemptedEngines] internal recursion guard.
 */
async function synthesizeSpeech(text, voiceId = 'Ruth', requestedEngine = null, options = {}) {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required for speech synthesis');
  }

  const attemptedEngines = options._attemptedEngines || [];
  const { voice: finalVoiceId, engine: finalEngine } = resolveVoiceAndEngine(
    voiceId, requestedEngine, { allowGenerative: options.allowGenerative }
  );

  // R-08: never log the text being synthesized — it is the interview
  // question/answer content (and may carry the candidate's name). Log the
  // resolved voice/engine and the character count only.
  diagnostics.log(`[Polly] Synthesizing: voice=${finalVoiceId}, engine=${finalEngine}, chars=${text.length}`);

  // A denied quota/stop switch is not a voice-engine failure. Do not retry
  // another engine or spend more attempts when admission was refused.
  await beforePaidCall('interview');
  try {
    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: finalVoiceId,
      Engine: finalEngine,
      TextType: 'text'
    });

    const response = await sendBounded(pollyClient,command);
    
    // Convert stream to base64
    const chunks = [];
    for await (const chunk of streamBounded(response.AudioStream,{label:'pollyBody'})) {
      if(remaining()<=0) throw new Error('TTS deadline exhausted');
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    const audioBase64 = audioBuffer.toString('base64');

    diagnostics.log(`[Polly] Synthesized ${audioBase64.length} bytes`);

    return {
      audioBase64,
      voiceId: finalVoiceId,
      engine: finalEngine
    };

  } catch (error) {
    diagnostics.error('Polly synthesis error:', error);

    // BUG FIX (infinite recursion): the old fallback retried 'neural' with
    // 'standard', but resolveVoiceAndEngine maps an unsupported engine back to
    // the voice's cheapest supported one — for Ruth that is 'neural' again. A
    // persistent Polly failure therefore recursed forever until the Lambda
    // timed out or the stack blew, instead of surfacing the error. Track which
    // engines have actually been attempted and stop when they are exhausted.
    // Record both the engine we asked for and the one resolveVoiceAndEngine
    // actually used — otherwise a request that keeps being remapped to an
    // already-failed engine never registers as attempted.
    const tried = [...attemptedEngines, finalEngine, requestedEngine].filter(Boolean);
    const nextEngine = ENGINE_FALLBACK_ORDER
      .slice(ENGINE_FALLBACK_ORDER.indexOf(finalEngine) + 1)
      .find(e => !tried.includes(e));

    if (nextEngine) {
      diagnostics.log(`[Polly] ${finalEngine} failed. Falling back to ${nextEngine} engine`);
      return synthesizeSpeech(text, finalVoiceId, nextEngine, {
        allowGenerative: options.allowGenerative,
        _attemptedEngines: tried
      });
    }

    diagnostics.error(`[Polly] All engines exhausted for voice ${finalVoiceId} (tried: ${tried.join(', ')})`);
    throw error;
  }
}

module.exports = {
  resolveVoiceAndEngine,
  synthesizeSpeech
};
