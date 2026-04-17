/**
 * Amazon Bedrock Client Wrapper specifically tuned for Qlue's Nemotron-4-340b-instruct pipeline.
 */
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { getBedrockConfig } = require('./secrets');
const { ERROR_CODES, QlueError } = require('./errors');

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

// The required Model ID
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'NVIDIA Nemotron 3 Super 120B A12B';

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
      
      const responseBody = JSON.parse(Buffer.from(response.body).toString('utf-8'));
      
      if (options.logTokens) {
        // Log tokens usage
        console.info(`[Bedrock Tokens] Prompt: ${responseBody.usage?.prompt_tokens}, Completion: ${responseBody.usage?.completion_tokens}`);
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
 * Builds the system prompt for Resume technical questions
 */
function buildResumeQuestionPrompt(parsedData, conversationHistory, turnIndex) {
  return [
    {
      role: 'system',
      content: `You are an expert technical interviewer. You are conducting an interview based on the following candidate resume parsing:
${JSON.stringify(parsedData)}
Your goal is to ask a targeted, challenging technical question about their experience. Keep your question concise.
Format your output strictly as a JSON object: {"question": "Your question text here"}`
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
Format your output strictly as a JSON object: {"question": "Your question text here"}`
    },
    ...conversationHistory
  ];
}

/**
 * Builds the system prompt for Website conceptual teaching
 */
function buildWebsiteTeachPrompt(concept, content, conceptState) {
  return [
    {
      role: 'system',
      content: `You are an expert tutor teaching the user about the website content provided below.
Content: ${content}

Currently, you are explaining the concept: "${concept}".
The current state of understanding is: ${JSON.stringify(conceptState)}

Provide an explanation or ask a checking question to verify the user understands.
Format your output strictly as a JSON object: {"response": "Your tutor response", "conceptMastered": boolean}`
    }
  ];
}

/**
 * Builds the system prompt for evaluating Self-Introductions
 */
function buildSelfIntroEvalPrompt(transcript) {
  return {
    prompt: `You are an expert communication coach evaluating a self-introduction.
Please evaluate the following transcript and provide feedback on clarity, confidence, and structure.
Transcript:
${JSON.stringify(transcript)}

Format your output strictly as JSON with keys: "feedback", "rating" (1-10)`
  };
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
  buildConceptExtractionPrompt
};
