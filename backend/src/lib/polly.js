/**
 * Wrapper for AWS Polly streaming integration.
 */
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const polly = new PollyClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
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
  const engine = options.Engine || 'neural';
  
  // Polly has a 3000 character limit for regular text. 
  // We handle TextLengthExceededException proactively by chunking.
  const textChunks = splitTextAtSentences(text, 2900);
  let globalChunkIndex = 0;

  for (let t = 0; t < textChunks.length; t++) {
    const chunkText = textChunks[t];
    
    const command = new SynthesizeSpeechCommand({
      Engine: engine,
      VoiceId: voiceId,
      OutputFormat: 'pcm',
      Text: chunkText,
      SampleRate: '16000'
    });

    try {
      const response = await polly.send(command);
      
      // response.AudioStream is a Readable stream in Node.js
      const stream = response.AudioStream;
      const CHUNK_SIZE = 4096;
      let buffer = Buffer.alloc(0);

      for await (const data of stream) {
        buffer = Buffer.concat([buffer, data]);
        
        while (buffer.length >= CHUNK_SIZE) {
          const chunk = buffer.subarray(0, CHUNK_SIZE);
          buffer = buffer.subarray(CHUNK_SIZE);
          yield {
            chunkIndex: globalChunkIndex++,
            audioData: chunk.toString('base64'),
            isLast: false // managed below
          };
        }
      }
      
      // yield remainder if it exists
      if (buffer.length > 0) {
        const isVeryLast = t === textChunks.length - 1;
        yield {
          chunkIndex: globalChunkIndex++,
          audioData: buffer.toString('base64'),
          isLast: isVeryLast
        };
      } else if (t === textChunks.length - 1) {
        // if buffer exactly hit 0 but it's the last chunk of last item
        yield {
          chunkIndex: globalChunkIndex++,
          audioData: '',
          isLast: true
        };
      }

    } catch (error) {
      console.error('Polly Synthesis Error:', error);
      throw error;
    }
  }
}

module.exports = {
  getEstimatedDuration,
  synthesizeToBase64Chunks
};
