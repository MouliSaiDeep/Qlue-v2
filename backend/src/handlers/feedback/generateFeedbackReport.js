/**
 * Lambda handler for generating qualitative feedback reports using Bedrock.
 * Optimized for speed using Claude 3 Haiku and flattened storage pipeline.
 */
const { invokeModel, buildFeedbackPrompt } = require('../../lib/bedrock');
const { createFeedbackReport } = require('../../models/feedback');
const { updateSessionState, INTERVIEW_STATES } = require('../../models/session');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const NOTIFY_LAMBDA = process.env.SEND_NOTIFICATION_LAMBDA;
const FEEDBACK_MODEL = process.env.FEEDBACK_MODEL_ID;

function getRealisticSummary(score, moduleType) {
  if (score >= 85) return `Candidate demonstrated strong proficiency in the ${moduleType} module and meets hiring standards for this specific area.`;
  if (score >= 70) return `Candidate showed baseline competence in the ${moduleType} module, but requires targeted improvement before being considered competitive.`;
  if (score >= 50) return `Candidate exhibited significant gaps in the ${moduleType} module. Core competencies were not adequately demonstrated.`;
  return `Candidate failed to meet minimum expectations for the ${moduleType} module. Fundamental review of concepts and communication is required.`;
}

exports.handler = async (event) => {
  const { sessionId, userId, moduleType, transcript, metadata } = event;
  const dimensionScores = event.dimensionScores || event.accumulatedScores || {};

  try {
    console.info(`Generating qualitative feedback for session ${sessionId} using ${FEEDBACK_MODEL}`);

    // 1. Compute overall score using computeModuleScores internal handler logic
    const computeModuleScores = require('../interview/computeModuleScores');
    const scoreResult = await computeModuleScores.handler({ dimensionScores, moduleType });
    const overallScore = scoreResult.overallScore || 0;
    const finalDimensionScores = scoreResult.normalizedScores || dimensionScores;

    // 2. Build prompt and invoke Bedrock (Claude 3 Haiku is 10x faster than Nemotron)
    const promptParams = buildFeedbackPrompt(moduleType, transcript, finalDimensionScores);
    const bedrockResponse = await invokeModel(FEEDBACK_MODEL, promptParams, { logTokens: true });
    
    // 3. Parse Bedrock response
    let feedbackData = {};
    try {
      const text = bedrockResponse.content?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      feedbackData = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse Bedrock feedback JSON:', e);
      feedbackData = {
        strengths: ['Unable to extract specific strengths from this session.'],
        improvements: ['System error prevented detailed weakness extraction.'],
        recommendations: ['Review transcript manually.']
      };
    }

    // 4. Prepare complete report payload
    const reportPayload = {
      sessionId,
      userId,
      moduleType,
      generatedAt: Date.now(),
      overallScore: Math.round(overallScore * 10) / 10,
      dimensionScores: finalDimensionScores,
      strengths: feedbackData.strengths || [],
      weaknesses: feedbackData.improvements || feedbackData.weaknesses || [],
      recommendations: feedbackData.recommendations || [],
      executiveSummary: feedbackData.summary || getRealisticSummary(overallScore, moduleType),
      sessionMetadata: {
        ...metadata,
        modelUsed: FEEDBACK_MODEL,
        tokenUsage: bedrockResponse.usage
      }
    };

    // 5. Store the feedback report directly
    console.info(`Storing feedback report for session ${sessionId}`);
    const storeResult = await createFeedbackReport(reportPayload);
    if (!storeResult.success) {
      throw new Error(`Failed to store feedback: ${storeResult.error?.message}`);
    }
    const feedbackId = storeResult.feedbackId;

    // 6. Update session record directly
    console.info(`Updating session ${sessionId} with final state and scores`);
    await updateSessionState(sessionId, INTERVIEW_STATES.TERMINATED, null, {
      accumulatedScores: finalDimensionScores,
      overallScore: Math.round(overallScore * 10) / 10,
      updatedAt: new Date().toISOString()
    });

    // 7. Trigger notification directly
    if (NOTIFY_LAMBDA) {
      console.info(`Triggering completion notification for user ${userId}`);
      const notifyCommand = new InvokeCommand({
        FunctionName: NOTIFY_LAMBDA,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          userId,
          sessionId,
          feedbackId,
          overallScore,
          moduleType
        }))
      });
      await lambdaClient.send(notifyCommand);
    }

    console.info(`Feedback generation and storage completed for session ${sessionId}`);
    return { success: true, feedbackId };

  } catch (error) {
    console.error(`Feedback generation failed for session ${sessionId}:`, error);
    throw error;
  }
};