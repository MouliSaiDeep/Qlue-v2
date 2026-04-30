/**
 * Amazon Bedrock Client Wrapper specifically tuned for Qlue's Nemotron-4-340b-instruct pipeline.
 */
const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
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
 * Executes a Model Invocation using Converse API
 */
async function invokeModel(modelId, params, options = {}) {
  const resolvedModelId = modelId || DEFAULT_MODEL_ID;
  const systemPrompt = "You are Qlue, an elite technical interviewer.";
  
  const command = new ConverseCommand({
    modelId: resolvedModelId,
    messages: params.messages || [],
    system: params.system ? [{ text: params.system }] : [{ text: systemPrompt }],
    inferenceConfig: {
      maxTokens: params.max_tokens || 1000,
      temperature: params.temperature || 0.7,
      topP: 0.9
    }
  });

  const maxRetries = options.retries || 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await bedrockClient.send(command);
      
      // Standardize response format
      const responseBody = {
        content: [{ text: response.output?.message?.content?.[0]?.text ?? '' }],
        usage: response.usage
      };

      if (options.logTokens) {
        console.info(`[Bedrock Tokens] Input: ${responseBody.usage?.inputTokens || '?'}, Output: ${responseBody.usage?.outputTokens || '?'}`);
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
async function invokeModelStream(modelId, params, onToken) {
    const resolvedModelId = modelId || DEFAULT_MODEL_ID;
    const systemPrompt = "You are Qlue, an elite technical interviewer.";

    const command = new ConverseStreamCommand({
        modelId: resolvedModelId,
        messages: params.messages || [],
        system: params.system ? [{ text: params.system }] : [{ text: systemPrompt }],
        inferenceConfig: {
            maxTokens: params.max_tokens || 1000,
            temperature: params.temperature || 0.7,
            topP: 0.9
        }
    });

    try {
        const abortController = new AbortController();
        // 45s initial timeout for large model TTFT
        let timeoutTimer = setTimeout(() => {
            abortController.abort();
        }, 45000);

        const response = await bedrockClient.send(command, { abortSignal: abortController.signal });
        let fullText = "";

        for await (const event of response.stream) {
            // Reset to 15s strictly for the gap between individual tokens
            clearTimeout(timeoutTimer);
            timeoutTimer = setTimeout(() => {
                abortController.abort();
            }, 15000);

            if (event.contentBlockDelta) {
                const token = event.contentBlockDelta.delta.text;
                fullText += token;
                if (onToken) onToken(token);
            }
        }
        clearTimeout(timeoutTimer);
        return fullText;
    } catch (error) {
        console.error('Bedrock Streaming Error:', error);
        if (error.name === 'AbortError' || error.message === 'BEDROCK_TIMEOUT' || error.name === 'TimeoutError') {
            throw new QlueError('Bedrock stream timed out after 15 seconds of inactivity.', 'BEDROCK_TIMEOUT', 504, error.message);
        }
        throw new QlueError('Bedrock Streaming Error', 'BEDROCK_ERROR', 500, error.message);
    }
}


/**
 * Builds the system prompt for Interview Modes (RESUME, HR, SELF_INTRO)
 */
function buildInterviewPrompt(context, history, turnCount, moduleType) {
  let systemContent = "";

  if (moduleType === 'RESUME') {
    const questionTypes = ['depth', 'experience', 'problem-solving'];
    const questionType = questionTypes[turnCount % questionTypes.length];

    systemContent = `You are Qlue, a technical interviewer with the candidate's resume.
Resume data:
${typeof context === 'object' ? JSON.stringify(context) : context}

CRITICAL VOICE RULES:
- Output will be spoken aloud. Write ONLY what a human interviewer would say.
- NEVER use markdown, bullet points, numbered lists, or formatting.
- NEVER evaluate the previous answer or include meta-commentary.
- NEVER repeat a question already asked.
- NEVER greet the user or introduce yourself. The system already handled the greeting.
- Keep each response to ONE technical question, max 40 words.
- Use complete sentences. End with a clear question.
- Spell out technical terms on first use.
Reference specific technologies and projects from the resume.
This turn's question type: ${questionType}. Alternate between depth, experience, and problem-solving questions.
After 6-8 questions, conclude with 'Thank you. The technical interview is complete.'`;

  } else if (moduleType === 'HR') {
    const hrTopics = ['teamwork', 'problem-solving', 'leadership', 'conflict', 'adaptability'];
    const currentTopic = hrTopics[turnCount % hrTopics.length];

    systemContent = `You are Qlue, a professional HR interviewer.
Current topic: ${currentTopic}.

CRITICAL VOICE RULES:
- Output will be spoken aloud. Write ONLY spoken text.
- NEVER use markdown, bullet points, numbered lists, or formatting.
- NEVER evaluate, give feedback, or include meta-commentary.
- NEVER repeat a question already asked.
- NEVER greet the user or introduce yourself. The system already handled the greeting.
- Keep each response to ONE behavioral question, max 40 words.
- Use complete sentences. End with a question mark.
Progress through: teamwork, problem-solving, leadership, conflict, adaptability.
Use STAR framework questions with specific scenarios.
After 5-6 questions, conclude with 'Thank you. This concludes our interview.'`;

  } else if (moduleType === 'INTRO') {
    systemContent = `You are Qlue, a communication coach. NEVER use markdown or bullet points.
Write ONLY spoken text, max 40 words per response.
Do NOT evaluate or give feedback during the exercise.
Do NOT greet the user or introduce yourself.
Ask one follow-up question about the introduction.`;

  } else {
    systemContent = `You are Qlue, an interviewer. Ask one concise question, max 40 words.
NEVER use markdown, bullet points, or formatting. Write ONLY spoken text.
Do NOT greet the user or introduce yourself.
Wait for the user to respond.`;
  }

  return {
    system: systemContent,
    messages: [
      ...history,
      { role: 'user', content: [{ text: turnCount === 0 ? "Let's begin the interview." : "Please ask the next question." }] }
    ]
  };
}

/**
 * Builds the system prompt for Tutor Mode (WEBSITE)
 */
function buildTutorPrompt(websiteUrl, history, userAnswer) {
  return {
    system: `You are Qlue, a patient tutor. The user is learning from: ${websiteUrl}.
Output will be spoken aloud.
NEVER use markdown, bullet points, or formatting.
Max 50 words for explanations, 25 words for questions.
When correct: confirm in 5 words max then ask next question.
When incorrect: correct in one sentence then ask next question.
NEVER lecture for more than two sentences.`,
    messages: [
      ...history,
      { role: 'user', content: [{ text: userAnswer ? `My answer: ${userAnswer}` : "Let's begin." }] }
    ]
  };
}

/**
 * General scoring based on module dimensions
 */
function buildScoringPrompt(moduleType, latestResponse, dimensions) {
  return {
    system: `You are an interview evaluator. Score ONLY the candidate's LATEST response.
Dimensions: ${dimensions.join(', ')}.
Rules:
- Score each dimension 1-100 based ONLY on the latest response.
- 3+ sentences with examples = 70-100. 1-2 sentences = 30-60. Short or irrelevant = 1-30.
- Return ONLY a raw JSON object with dimension names as keys and numeric scores as values. 
- Do NOT use markdown code blocks (\`\`\`json). Do NOT include any conversational text.`,
    messages: [
      {
        role: 'user',
        content: [{ text: `Score ONLY the latest response inside the XML tags across the listed dimensions: <user_input>${typeof latestResponse === 'string' ? latestResponse : JSON.stringify(latestResponse)}</user_input>` }]
      }
    ]
  };
}

/**
 * General qualitative feedback generation
 */
function buildFeedbackPrompt(moduleType, transcript, scores) {
  return {
    system: `You are an AI Interview coach providing actionable feedback.
Provide 3 key strengths and 3 areas for improvement. 
Format ONLY as a raw JSON object: {"strengths": [], "improvements": []}
Do NOT use markdown code blocks.`,
    messages: [
      {
        role: 'user',
        content: [{ text: `Review the following ${moduleType} session. 
Scores: ${JSON.stringify(scores)}
Transcript: <user_input>${JSON.stringify(transcript)}</user_input>
Please provide constructive feedback.` }]
      }
    ]
  };
}

/**
 * Concept extraction from scraped website content
 */
function buildConceptExtractionPrompt(content) {
  return {
    system: `Act as a semantic parser. Extract the top 3-5 core concepts from the provided text that a user should learn.
Format ONLY as a raw JSON array of strings: {"concepts": ["concept1", "concept2"]}
Do NOT use markdown code blocks.`,
    messages: [
      {
        role: 'user',
        content: [{ text: `Extract concepts from the following text: <user_input>${content.substring(0, 5000)}</user_input>` }]
      }
    ]
  };
}

function buildResumeQuestionPrompt(resumeData, history, turnCount) {
  const systemContent = `You are Qlue, an elite technical interviewer. You are conducting an interview based on the following resume data:
${typeof resumeData === 'object' ? JSON.stringify(resumeData) : resumeData}

Instructions:
- Ask exactly one concise technical question.
- Do not evaluate the previous answer.
- Focus on specific technologies or projects mentioned in the resume.
- Return ONLY the question text (or a JSON with "question" field if required by the caller).`;

  const messages = [
    ...history,
    { role: 'user', content: [{ text: turnCount === 0 ? "Let's begin the interview." : "Generate the next technical question." }] }
  ];
  return { system: systemContent, messages };
}

function buildHRQuestionPrompt(context, history) {
  const systemContent = `You are an HR recruiter. Ask one concise behavioral question using the STAR framework. Do not evaluate the previous answer.`;
  const messages = [
    ...history,
    { role: 'user', content: [{ text: "Generate the next behavioral question." }] }
  ];
  return { system: systemContent, messages };
}

function buildWebsiteTeachPrompt(targetConcept, content, history, isEvaluation) {
  const systemContent = `You are a tutor helping a student learn about ${targetConcept}.
Instructions:
- If isEvaluation is true, check the last answer and provide feedback.
- Ask a follow-up question to test understanding.
- Return response ONLY as a raw JSON object: {"response": "your feedback and next question", "isCorrect": true/false}
- Do NOT use markdown code blocks.
- Source material: ${content.substring(0, 5000)}`;

  const messages = [
    ...history,
    { role: 'user', content: [{ text: isEvaluation ? "Evaluate my response and ask the next question." : `Introduce ${targetConcept} and ask a question.` }] }
  ];
  return { system: systemContent, messages };
}

function buildSelfIntroEvalPrompt(transcript) {
  return {
    system: `You are an expert communication coach. Evaluate the self-introduction provided.
Provide constructive feedback and a follow-up question to improve the pitch.
Return response ONLY as a raw JSON object: {"response": "your feedback and follow-up"}
Do NOT use markdown code blocks.`,
    messages: [
      { role: 'user', content: [{ text: `Introduction to evaluate: <user_input>${transcript}</user_input>` }] }
    ]
  };
}

module.exports = {
  invokeModel,
  buildInterviewPrompt,
  buildTutorPrompt,
  buildScoringPrompt,
  buildFeedbackPrompt,
  buildConceptExtractionPrompt,
  buildResumeQuestionPrompt,
  buildHRQuestionPrompt,
  buildWebsiteTeachPrompt,
  buildSelfIntroEvalPrompt,
  invokeModelStream
};
