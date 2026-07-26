const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const pollyClient = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });

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
 * Whether generative synthesis is permitted for this specific request.
 * Priority: explicit per-request opt-in (Premium voice mode) > env default.
 * The env var remains a global kill-switch: if POLLY_ALLOW_GENERATIVE is
 * explicitly 'false' it blocks even Premium requests (useful once free credits
 * run out); otherwise the per-request flag decides.
 */
function isGenerativeAllowed(allowGenerative) {
  if (process.env.POLLY_ALLOW_GENERATIVE === 'false') return false; // hard global block
  if (allowGenerative === true) return true;                        // Premium request
  return process.env.POLLY_ALLOW_GENERATIVE === 'true';             // env-level opt-in
}

/**
 * Resolve the (voice, engine) pair actually sent to Polly.
 * - Honours the requested engine when the voice supports it, else falls back
 *   to the cheapest engine that voice offers.
 * - Cost-saver mode (default): unless generative is allowed for this request
 *   (Premium voice mode) or via POLLY_ALLOW_GENERATIVE=true, any resolution
 *   that lands on 'generative' is substituted with Ruth/neural, keeping
 *   synthesis inside the 1M-chars/month neural free tier.
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
    console.log(`[Polly] Cost-saver: substituting ${voice}/generative -> ${COST_SAVER_VOICE}/neural (use Premium voice mode or POLLY_ALLOW_GENERATIVE=true to opt in)`);
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

  console.log(`[Polly] Synthesizing: voice=${finalVoiceId}, engine=${finalEngine}, text="${text.substring(0, 50)}..."`);

  try {
    const command = new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'mp3',
      VoiceId: finalVoiceId,
      Engine: finalEngine,
      TextType: 'text'
    });

    const response = await pollyClient.send(command);
    
    // Convert stream to base64
    const chunks = [];
    for await (const chunk of response.AudioStream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    const audioBase64 = audioBuffer.toString('base64');

    console.log(`[Polly] Synthesized ${audioBase64.length} bytes`);

    return {
      audioBase64,
      voiceId: finalVoiceId,
      engine: finalEngine
    };

  } catch (error) {
    console.error('Polly synthesis error:', error);

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
      console.log(`[Polly] ${finalEngine} failed. Falling back to ${nextEngine} engine`);
      return synthesizeSpeech(text, finalVoiceId, nextEngine, {
        allowGenerative: options.allowGenerative,
        _attemptedEngines: tried
      });
    }

    console.error(`[Polly] All engines exhausted for voice ${finalVoiceId} (tried: ${tried.join(', ')})`);
    throw error;
  }
}

module.exports = {
  resolveVoiceAndEngine,
  synthesizeSpeech
};
