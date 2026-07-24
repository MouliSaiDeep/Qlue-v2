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
 * Resolve the (voice, engine) pair actually sent to Polly.
 * - Honours the requested engine when the voice supports it, else falls back
 *   to the cheapest engine that voice offers.
 * - Cost-saver mode (default ON): unless POLLY_ALLOW_GENERATIVE=true, any
 *   resolution that lands on 'generative' is substituted with Ruth/neural,
 *   keeping synthesis inside the 1M-chars/month neural free tier.
 */
function resolveVoiceAndEngine(voiceId, requestedEngine) {
  const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
  let voice = allowedVoices.includes(voiceId) ? voiceId : COST_SAVER_VOICE;

  const support = VOICE_ENGINE_SUPPORT[voice] || ['neural'];
  let engine = requestedEngine || process.env.POLLY_DEFAULT_ENGINE || 'neural';
  if (!support.includes(engine)) {
    engine = support[0]; // cheapest engine this voice offers
  }

  if (engine === 'generative' && process.env.POLLY_ALLOW_GENERATIVE !== 'true') {
    console.log(`[Polly] Cost-saver: substituting ${voice}/generative -> ${COST_SAVER_VOICE}/neural (set POLLY_ALLOW_GENERATIVE=true to opt out)`);
    voice = COST_SAVER_VOICE;
    engine = 'neural';
  }

  return { voice, engine };
}

// Engines tried, in order, when the requested one fails.
const ENGINE_FALLBACK_ORDER = ['generative', 'neural', 'standard'];

async function synthesizeSpeech(text, voiceId = 'Ruth', requestedEngine = null, attemptedEngines = []) {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required for speech synthesis');
  }

  const { voice: finalVoiceId, engine: finalEngine } = resolveVoiceAndEngine(voiceId, requestedEngine);

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
      return synthesizeSpeech(text, finalVoiceId, nextEngine, tried);
    }

    console.error(`[Polly] All engines exhausted for voice ${finalVoiceId} (tried: ${tried.join(', ')})`);
    throw error;
  }
}

module.exports = {
  resolveVoiceAndEngine,
  synthesizeSpeech
};
