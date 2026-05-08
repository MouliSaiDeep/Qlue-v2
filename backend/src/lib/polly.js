const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const pollyClient = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });

const VOICE_ENGINE_MAP = {
  'Tiffany': 'neural',
  'Ruth': 'neural',
  'Joanna': 'neural',
  'Matthew': 'neural',
  'Stephen': 'neural',
  'Amy': 'standard',
  'Brian': 'standard',
  'Emma': 'neural',
  'Arthur': 'neural'
};

async function synthesizeSpeech(text, voiceId = 'Tiffany', requestedEngine = null) {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required for speech synthesis');
  }

  // Validate and resolve voice
  const allowedVoices = (process.env.ALLOWED_VOICES || 'Tiffany,Ruth,Joanna,Matthew,Stephen').split(',');
  const finalVoiceId = allowedVoices.includes(voiceId) ? voiceId : 'Tiffany';
  
  // Resolve engine: requested > voice default > neural
  const finalEngine = requestedEngine || VOICE_ENGINE_MAP[finalVoiceId] || 'neural';

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
    
    // Fallback logic: neural/generative -> standard
    if (finalEngine === 'generative') {
      console.log('[Polly] generative failed. Falling back to neural engine');
      return synthesizeSpeech(text, finalVoiceId, 'neural');
    } else if (finalEngine === 'neural') {
      console.log('[Polly] neural failed. Falling back to standard engine');
      return synthesizeSpeech(text, finalVoiceId, 'standard');
    }
    
    throw error;
  }
}

module.exports = {
  synthesizeSpeech
};
