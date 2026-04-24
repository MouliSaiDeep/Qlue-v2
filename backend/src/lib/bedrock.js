/**
 * Amazon Bedrock Client Wrapper specifically tuned for Qlue's Nemotron-4-340b-instruct pipeline.
 */
const { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { getBedrockConfig } = require('./secrets');
const { ERROR_CODES, QlueError } = require('./errors');

const bedrockClient = new BedrockRuntimeClient({ 
  region: process.env.AWS_REGION || 'us-east-1',
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 15000
  })
});

// The required Model ID
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'nvidia.nemotron-super-3-120b';

/**
 * Executes a Model Invocation with retries for Timeouts
 */
async function invokeModel(modelId = DEFAULT_MODEL_ID, body, options = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  
  const command = new InvokeModelCommand({
    body: payload,
    modelId: modelId,
    accept: 'application/json',
    contentType: 'application/json'
  });

  const maxRetries = options.retries || 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await bedrockClient.send(command);
      
      let responseBody = JSON.parse(Buffer.from(response.body).toString('utf-8'));
      
      // Normalize response format across models (Claude vs Nemotron)
      if (responseBody.choices && responseBody.choices[0].message) {
        responseBody.content = [{ text: responseBody.choices[0].message.content }];
      } else if (responseBody.choices && responseBody.choices[0].text) {
        responseBody.content = [{ text: responseBody.choices[0].text }];
      }

      if (options.logTokens) {
        // Log tokens usage
        console.info(`[Bedrock Tokens] Prompt: ${responseBody.usage?.prompt_tokens || '?'}, Completion: ${responseBody.usage?.completion_tokens || '?'}`);
      }

      return responseBody;
    } catch (error) {
      attempt++;
      if (error.name === 'ModelTimeoutException' || error.name === 'ThrottlingException' || error.$metadata?.httpStatusCode === 429) {
        if (attempt > maxRetries) {
          throw new QlueError('Bedrock Timeout after retries', ERROR_CODES.BEDROCK_TIMEOUT, 504, error.message);
        }
        await new Promise(res => setTimeout(res, attempt * 1000));
        continue;
      }
      throw new QlueError('Bedrock Invocation Error', ERROR_CODES.BEDROCK_ERROR, 500, error.message);
    }
  }
}

/**
 * Executes a Model Invocation with Streaming Output for low latency
 * @param {string} modelId 
 * @param {object} body 
 * @param {function} onToken Callback for each received token
 */
async function invokeModelStream(modelId = DEFAULT_MODEL_ID, body, onToken) {
    const command = new InvokeModelWithResponseStreamCommand({
        body: JSON.stringify(body),
        modelId,
        contentType: 'application/json',
        accept: 'application/json'
    });

    try {
        const response = await bedrockClient.send(command);
        let fullText = "";

        for await (const event of response.body) {
            const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
            
            // Nemotron / OpenAI format
            if (chunk.choices && chunk.choices[0].delta?.content) {
                const token = chunk.choices[0].delta.content;
                fullText += token;
                if (onToken) onToken(token);
            } else if (chunk.choices && chunk.choices[0].text) {
                const token = chunk.choices[0].text;
                fullText += token;
                if (onToken) onToken(token);
            }
        }
        return fullText;
    } catch (error) {
        console.error('Bedrock Streaming Error:', error);
        throw new QlueError('Bedrock Streaming Error', ERROR_CODES.BEDROCK_ERROR, 500, error.message);
    }
}


/**
 * Builds the system prompt for Resume technical questions
 */
function buildResumeQuestionPrompt(parsedData, conversationHistory, turnIndex) {
  return [
    {
      role: 'system',
      content: `You are an expert technical interviewer. You are conducting an interview based on the following candidate resume parsing:
${JSON.stringify(parsedData)}
Your goal is to ask a targeted, challenging technical question about their experience. Keep your question concise.
Return ONLY the question text, no JSON or extra formatting. Your response will be spoken directly to the user.`
    },
    ...conversationHistory
  ];
}

/**
 * Builds the system prompt for HR STAR format behavioral questions
 */
function buildHRQuestionPrompt(topic, conversationHistory) {
  return [
    {
      role: 'system',
      content: `You are an HR recruiter. We are discussing the topic: ${topic}.
Please ask a behavioral question using the STAR (Situation, Task, Action, Result) framework. Keep it concise.
Return ONLY the question text, no JSON or extra formatting. Your response will be spoken directly to the user.`
    },
    ...conversationHistory
  ];
}

/**
 * Builds the system prompt for Website conceptual teaching
 */
function buildWebsiteTeachPrompt(concept, content, conversationHistory, isAnswering = false) {
  const systemPrompt = isAnswering
    ? `You are an expert mentor helping the user understand the website content provided below.
Content: ${content}
Currently, you are explaining the concept: "${concept}".

The user has just answered your question.
1. Evaluate the user's answer.
2. If CORRECT: Give a warm compliment and proceed to ask the next logical question or explain the next nuance of ${concept}.
3. If WRONG: Explain the concept correctly in simple words (2-3 lines max) and ask: "Did you understand?". Be supportive and behave like a mentor.
Format your output strictly as a JSON object: {"response": "Your mentor response", "isCorrect": boolean}`
    : `You are an expert mentor teaching the user about the website content provided below.
Content: ${content}
Goal: Teach the concept: "${concept}".
Ask an initial question or provide a brief overview to start the conversation about "${concept}".
Return ONLY the response text, no JSON or extra formatting. Your response will be spoken directly to the user.`;

  return [
    { role: 'system', content: systemPrompt },
    ...conversationHistory
  ];
}

/**
 * Builds the system prompt for evaluating Self-Introductions
 */
function buildSelfIntroEvalPrompt(transcript) {
  return [
    {
      role: 'system',
      content: `You are an expert communication coach. The user just gave their self-introduction.
Please evaluate their response. 
1. Acknowledge their effort.
2. Identify exactly what is lacking (e.g., missing achievements, lack of structure, weak opening).
3. Provide 2-3 actionable suggestions to make it better.
Keep the tone encouraging.
Format your output strictly as a JSON object: {"response": "Your coaching feedback and suggestions"}`
    },
    { role: 'user', content: transcript }
  ];
}

/**
 * General scoring based on module dimensions
 */
function buildScoringPrompt(moduleType, transcript, dimensions) {
  return {
    prompt: `You are an AI Interview evaluator analyzing a ${moduleType} interview session.
Please score the applicant across these dimensions: ${dimensions.join(', ')}.
Transcript:
${JSON.stringify(transcript)}

Format your output strictly as JSON mapping each dimension to a score between 1-100.`
  };
}

/**
 * General qualitative feedback generation
 */
function buildFeedbackPrompt(moduleType, transcript, scores) {
  return {
    prompt: `You are an AI Interview coach providing actionable feedback.
Review the following ${moduleType} session.
Scores: ${JSON.stringify(scores)}
Transcript: ${JSON.stringify(transcript)}

Provide 3 key strengths and 3 areas for improvement. Format as JSON: {"strengths": [], "improvements": []}`
  };
}

/**
 * Concept extraction from scraped website content
 */
function buildConceptExtractionPrompt(content) {
  return {
    prompt: `Act as a semantic parser. Extract the top 3-5 core concepts from this webpage text that a user should learn.
Text: ${content.substring(0, 5000)}

Format as JSON array of strings: {"concepts": ["concept1", "concept2"]}`
  };
}

module.exports = {
  invokeModel,
  buildResumeQuestionPrompt,
  buildHRQuestionPrompt,
  buildWebsiteTeachPrompt,
  buildSelfIntroEvalPrompt,
  buildScoringPrompt,
  buildFeedbackPrompt,
  buildConceptExtractionPrompt,
  invokeModelStream
};
