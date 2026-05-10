/**
 * Lambda handler for computing normalized module scores from raw dimension scores.
 * Applies weightings per module type, checks for critical flaws, and computes a strict final 0-100 score.
 */

// Adjusted weights to heavily favor substance and problem-solving over surface-level fluency
const MODULE_WEIGHTS = {
  RESUME: { clarity: 0.15, fluency: 0.10, technicalVocabulary: 0.35, useOfExamples: 0.40 },
  HR: { teamwork: 0.20, ethicalThinking: 0.25, problemSolving: 0.25, communicationClarity: 0.15, selfAwareness: 0.15 },
  WEBSITE: { comprehensionAccuracy: 0.30, learningProgression: 0.15, criticalThinking: 0.25, responseClarity: 0.10, conceptRetention: 0.20 },
  INTRO: { clarity: 0.25, structure: 0.35, confidence: 0.15, relevance: 0.25 },
  SELF_INTRO: { clarity: 0.25, structure: 0.35, confidence: 0.15, relevance: 0.25 }
};

// Threshold below which a single dimension triggers a critical penalty
const CRITICAL_FLAW_THRESHOLD = 50; 
// Percentage reduction if a critical flaw is detected (15% penalty)
const CRITICAL_FLAW_PENALTY_MULTIPLIER = 0.85; 

exports.handler = async (event) => {
  const { dimensionScores, moduleType } = event;

  try {
    const weights = MODULE_WEIGHTS[moduleType] || {};
    const allKeys = Object.keys(dimensionScores);

    if (allKeys.length === 0) {
      return { success: true, overallScore: 0, normalizedScores: {} };
    }

    let weightedSum = 0;
    let totalWeight = 0;
    let hasCriticalFlaw = false;

    for (const key of allKeys) {
      const score = dimensionScores[key] || 0;
      const weight = weights[key] || (1 / allKeys.length); 
      
      weightedSum += score * weight;
      totalWeight += weight;

      // Flag if the candidate bombed a specific area
      if (score < CRITICAL_FLAW_THRESHOLD) {
        hasCriticalFlaw = true;
      }
    }

    let normalizedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Apply real-world penalty: A severe weakness drags down the entire evaluation
    if (hasCriticalFlaw && normalizedScore > 0) {
      normalizedScore = normalizedScore * CRITICAL_FLAW_PENALTY_MULTIPLIER;
    }

    return {
      success: true,
      overallScore: Math.round(normalizedScore * 10) / 10,
      hasCriticalFlaw: hasCriticalFlaw,
      normalizedScores: dimensionScores
    };
  } catch (error) {
    console.error('Score computation failed:', error);
    throw error;
  }
};