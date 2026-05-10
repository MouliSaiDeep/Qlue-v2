/**
 * Lambda handler for Bedrock-based transcript analysis.
 */
const { invokeModel, buildScoringPrompt } = require('../../lib/bedrock');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const REPORT_LAMBDA = process.env.GENERATE_REPORT_LAMBDA;

const MODULE_DIMENSIONS = {
  RESUME: ['Technical Accuracy', 'Clarity', 'Use of Examples'],
  HR: ['Problem Solving', 'Communication', 'Self Awareness'],
  WEBSITE: ['Comprehension', 'Critical Thinking', 'Concept Retention'],
  INTRO: ['Clarity', 'Structure', 'Confidence'],
  SELF_INTRO: ['Clarity', 'Structure', 'Confidence'] // Alias for backward compatibility
};

exports.handler = async (event) => {
  const { sessionId, userId, moduleType, transcript, contextRef, metadata } = event;

  try {
    console.info(`Starting Bedrock analysis for session ${sessionId} (${moduleType})`);
    
    // 1. Identify dimensions
    const dimensions = MODULE_DIMENSIONS[moduleType] || ['performance'];
    
    // 2. Build scoring prompt and invoke Bedrock
    const promptParams = buildScoringPrompt(moduleType, transcript, dimensions);
    const bedrockResponse = await invokeModel(undefined, promptParams, { logTokens: true, retries: 3 });
    
    // 3. Parse and validate scores
    // invokeModel returns { content: [{ text }], usage }
    let dimensionScores = {};
    try {
      const text = bedrockResponse.content?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      dimensionScores = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (e) {
      console.error('Failed to parse Bedrock score JSON:', e);
      dimensionScores = dimensions.reduce((acc, d) => ({ ...acc, [d]: 50 }), {}); // Fallback
    }

    // Ensure scores are in 0-100 range and mapped correctly
    const finalScores = {};
    dimensions.forEach(d => {
      let val = dimensionScores[d] || 50;
      finalScores[d] = Math.max(0, Math.min(100, val));
    });

    // 4. Trigger computeModuleScores and next step
    // NOTE: Task 8 says computeModuleScores is Mouli's. I will invoke it here if needed,
    // but usually, it's just a formula. We'll pass raw scores to the report generator.
    
    const nextPayload = {
      sessionId,
      userId,
      moduleType,
      transcript,
      dimensionScores: finalScores,
      metadata
    };

    console.info(`Scoring complete for ${sessionId}. Triggering report generation.`);
    
    const command = new InvokeCommand({
      FunctionName: REPORT_LAMBDA,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(nextPayload))
    });

    await lambdaClient.send(command);
    
    return { success: true, sessionId, scores: finalScores };

  } catch (error) {
    console.error(`Analysis failed for session ${sessionId}:`, error);
    throw error; // Rethrow for Lambda retries if needed
  }
};
