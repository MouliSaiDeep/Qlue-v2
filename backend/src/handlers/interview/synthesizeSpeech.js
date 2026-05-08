const { synthesizeSpeech: pollySynthesizeSpeech } = require('../../lib/polly');

/**
 * Legacy speech synthesis wrapper for non-WebSocket flows.
 */
module.exports = {
  synthesizeSpeech: async (text, options = {}) => {
    const voiceId = options.voiceId || 'Tiffany';
    const engine = options.engine || null;
    const result = await pollySynthesizeSpeech(text, voiceId, engine);
    return {
      audioBase64: result.audioBase64,
      voiceId: result.voiceId,
      engine: result.engine,
      audioUrl: null
    };
  }
};
