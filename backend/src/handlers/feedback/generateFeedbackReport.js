/**
 * Lambda handler for generating qualitative feedback reports using Bedrock.
 */
const { invokeModel, buildFeedbackPrompt } = require('../../lib/bedrock');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const STORE_LAMBDA = process.env.STORE_FEEDBACK_LAMBDA;

exports.handler = async (event) => {
  const { sessionId, userId, moduleType, transcript, dimensionScores, metadata } = event;

  try {
    console.info(`Generating qualitative feedback for session ${sessionId}`);

    // 1. Build feedback prompt and invoke Bedrock
    const promptParams = buildFeedbackPrompt(moduleType, transcript, dimensionScores);

    const bedrockResponse = await invokeModel(undefined, promptParams, { logTokens: true });
    
    // 2. Parse Bedrock response
    let feedbackData = {};
    try {
      const text = bedrockResponse.content?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      feedbackData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (e) {
      console.error('Failed to parse Bedrock feedback JSON:', e);
      feedbackData = {
        strengths: ['Completed the session'],
        improvements: ['No specific improvements found'],
        recommendations: ['Practice more regularly']
      };
    }

    // 3. Compute overall score (Average of dimensions as fallback for computeModuleScores)
    const scores = Object.values(dimensionScores);
    const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;

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
      executiveSummary: feedbackData.summary || `Overall performance in the ${moduleType} session was ${overallScore >= 70 ? 'strong' : 'moderate'}.`,
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
