/**
 * Lambda handler for generating qualitative feedback reports using Bedrock.
 */
const { invokeModel, buildFeedbackPrompt } = require('../../lib/bedrock');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const STORE_LAMBDA = process.env.STORE_FEEDBACK_LAMBDA;

function getRealisticSummary(score, moduleType) {
  if (score >= 85) return `Candidate demonstrated strong proficiency in the ${moduleType} module and meets hiring standards for this specific area.`;
  if (score >= 70) return `Candidate showed baseline competence in the ${moduleType} module, but requires targeted improvement before being considered competitive.`;
  if (score >= 50) return `Candidate exhibited significant gaps in the ${moduleType} module. Core competencies were not adequately demonstrated.`;
  return `Candidate failed to meet minimum expectations for the ${moduleType} module. Fundamental review of concepts and communication is required.`;
}

exports.handler = async (event) => {
  const { sessionId, userId, moduleType, transcript, dimensionScores, metadata } = event;

  try {
    console.info(`Generating qualitative feedback for session ${sessionId}`);

    // 1. Build feedback prompt and invoke Bedrock
    // Note: Ensure buildFeedbackPrompt explicitly instructs the LLM to "be brutally honest, objective, and do not sugar-coat weaknesses."
    const promptParams = buildFeedbackPrompt(moduleType, transcript, dimensionScores);

    const bedrockResponse = await invokeModel(undefined, promptParams, { logTokens: true });
    
    // 2. Parse Bedrock response
    let feedbackData = {};
    try {
      const text = bedrockResponse.content?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      feedbackData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse Bedrock feedback JSON:', e);
      // Realistic fallback instead of fake positivity
      feedbackData = {
        strengths: ['Unable to extract specific strengths from this session.'],
        improvements: ['System error prevented detailed weakness extraction. Review transcript manually.'],
        recommendations: ['Repeat the module to generate a complete qualitative profile.']
      };
    }

    // 3. Compute overall score (Average of dimensions as fallback for computeModuleScores)
    const scores = Object.values(dimensionScores);
    const overallScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    // 4. Prepare complete report payload
    const reportPayload = {
      sessionId,
      userId,
      moduleType,
      overallScore: Math.round(overallScore * 10) / 10, // 1 decimal place
      dimensionScores,
      strengths: feedbackData.strengths || [],
      weaknesses: feedbackData.improvements || feedbackData.weaknesses || [],
      recommendations: feedbackData.recommendations || [],
      // Use the strict tiered summary rather than a sugar-coated default
      executiveSummary: feedbackData.summary || getRealisticSummary(overallScore, moduleType),
      sessionMetadata: metadata
    };

    console.info(`Feedback report generated for ${sessionId}. Triggering storage.`);
    
    const command = new InvokeCommand({
      FunctionName: STORE_LAMBDA,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(reportPayload))
    });

    await lambdaClient.send(command);
    
    return { success: true, sessionId };

  } catch (error) {
    console.error(`Feedback generation failed for session ${sessionId}:`, error);
    throw error;
  }
};