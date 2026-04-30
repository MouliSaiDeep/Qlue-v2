/**
 * Lambda handler for computing normalized module scores from raw dimension scores.
 * Applies weightings per module type and computes a final 0-100 score.
 */

const MODULE_WEIGHTS = {
  RESUME: { clarity: 0.25, fluency: 0.20, technicalVocabulary: 0.25, useOfExamples: 0.30 },
  HR: { teamwork: 0.25, ethicalThinking: 0.20, problemSolving: 0.20, communicationClarity: 0.20, selfAwareness: 0.15 },
  WEBSITE: { comprehensionAccuracy: 0.25, learningProgression: 0.20, criticalThinking: 0.20, responseClarity: 0.15, conceptRetention: 0.20 },
  SELF_INTRO: { clarity: 0.30, structure: 0.25, confidence: 0.25, relevance: 0.20 }
};

exports.handler = async (event) => {
  const { dimensionScores, moduleType } = event;

  try {
    const weights = MODULE_WEIGHTS[moduleType] || {};
    const allKeys = Object.keys(dimensionScores);

    let weightedSum = 0;
    let totalWeight = 0;

    for (const key of allKeys) {
      const weight = weights[key] || (1 / allKeys.length); // Equal weight for unknown dims
      weightedSum += (dimensionScores[key] || 0) * weight;
      totalWeight += weight;
    }

    const normalizedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return {
      success: true,
      overallScore: Math.round(normalizedScore * 10) / 10,
      normalizedScores: dimensionScores
    };
  } catch (error) {
    console.error('Score computation failed:', error);
    throw error;
  }
};
