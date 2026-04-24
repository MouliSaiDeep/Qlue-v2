/**
 * Wrapper for AWS Polly streaming integration.
 */
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const polly = new PollyClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 15000
  })
});

/**
 * Gets an estimated duration in ms for text
 * Based on 150 WPM (2.5 words per second)
 */
function getEstimatedDuration(text) {
  if (!text) return 0;
  const wordCount = text.split(/\s+/).length;
  // (words / 2.5 words_per_sec) * 1000 ms_per_sec
  return Math.ceil((wordCount / 2.5) * 1000);
}

/**
 * Validates and splits text at sentence boundaries if too long
 */
function splitTextAtSentences(text, maxLength = 3000) {
  if (!text) return [""];
  if (text.length <= maxLength) return [text];

  
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = '';
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  
  return chunks;
}

/**
 * Synthesizes text to speech and yields base64 chunks
 */
async function* synthesizeToBase64Chunks(text, options = {}) {
  const voiceId = options.VoiceId;
  if (!voiceId) {
    throw new Error('Voice ID must be provided by the user');
  }
  const engine = options.Engine || 'generative';
  
  // Polly has a 3000 character limit for regular text. 
  // We handle TextLengthExceededException proactively by chunking.
  const textChunks = splitTextAtSentences(text, 2900);
  let globalChunkIndex = 0;

  for (let t = 0; t < textChunks.length; t++) {
    const chunkText = textChunks[t];
    
    // Build SSML text with prosody and breathing for natural speech
    const ssmlText = buildEnhancedSSML(chunkText);

    const command = new SynthesizeSpeechCommand({
      Engine: engine,
      VoiceId: voiceId,
      OutputFormat: 'mp3',
      Text: ssmlText,
      TextType: 'ssml',
      SampleRate: '24000' // generative engine supports higher quality
    });

    try {
      console.debug(`[Polly] Sending request for chunk: "${chunkText.substring(0, 50)}..."`);
      const response = await polly.send(command);
      const stream = response.AudioStream;

      const TARGET_CHUNK_SIZE = 32768; 
      let buffer = Buffer.alloc(0);
      let isFirstInChunk = true;

      console.debug(`[Polly] Stream received, processing chunks...`);
      for await (const data of stream) {
        buffer = Buffer.concat([buffer, data]);

        // ULTRA-LOW LATENCY: Yield the very first packet immediately, regardless of size
        // Subsequent packets are grouped into 32KB to maintain efficiency.
        if (isFirstInChunk || buffer.length >= TARGET_CHUNK_SIZE) {
          console.debug(`[Polly] Yielding chunk ${globalChunkIndex} (Size: ${buffer.length}, first: ${isFirstInChunk})`);
          yield {
            chunkIndex: globalChunkIndex++,
            audioData: buffer.toString('base64')
          };
          buffer = Buffer.alloc(0);
          isFirstInChunk = false;
        }
      }
      
      const isVeryLastInSequence = t === textChunks.length - 1;
      
      if (buffer.length > 0) {
        console.debug(`[Polly] Yielding final buffer chunk ${globalChunkIndex}`);
        yield {
          chunkIndex: globalChunkIndex++,
          audioData: buffer.toString('base64')
        };
      }

    } catch (error) {
      console.error('Polly Synthesis Error:', error);
      throw error;
    }
  }
}


/**
 * Builds enhanced SSML markup for more natural and human-like speech.
 * - Adds subtle prosody variations to avoid monotone delivery
 * - Inserts micro-pauses at natural speech boundaries (commas, periods)
 * - Adds breathing pauses before long sentences
 * - Uses amazon:effect for breath sounds where supported
 */
function buildEnhancedSSML(text) {
  // If already wrapped in <speak>, return as-is
  if (text.trim().startsWith('<speak>')) return text;

  // Remove any existing <speak> or </speak> fragments to avoid nesting
  let cleanText = text.replace(/<\/?speak>/g, '').trim();

  // Escape XML special characters (&, <, >) — MUST do this first before adding tags
  cleanText = cleanText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Add micro-pauses after punctuation for natural rhythm
  cleanText = cleanText
    .replace(/:\s+/g, '<break time="200ms"/> ')
    .replace(/;\s+/g, '<break time="150ms"/> ')
    .replace(/,\s+/g, '<break time="100ms"/> ');

  // Add pause before question marks
  cleanText = cleanText.replace(/\?\s*/g, '<break time="200ms"/>? ');

  // Add breath pause before conjunctions at sentence start
  cleanText = cleanText.replace(
    /(^|\.\s+)(And|But|So|Now|Well|OK|Okay|Right|Actually|However|Therefore|Meanwhile)\b/g,
    '$1<break time="300ms"/> $2'
  );

  // Simple <speak> wrapper — NO <prosody> (Generative engine handles prosody naturally)
  return '<speak>' + cleanText + '</speak>';
}

module.exports = {
  getEstimatedDuration,
  synthesizeToBase64Chunks,
  buildEnhancedSSML
};
