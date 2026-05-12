const { handler } = require('../../src/handlers/feedback/computeModuleScores');

describe('computeModuleScores handler', () => {
  it('should return 0 if dimensionScores is empty', async () => {
    const event = { dimensionScores: {}, moduleType: 'RESUME' };
    const result = await handler(event);
    expect(result.overallScore).toBe(0);
  });

  it('should calculate weighted average correctly for RESUME module', async () => {
    const event = {
      moduleType: 'RESUME',
      dimensionScores: {
        clarity: 80,
        fluency: 70,
        technicalVocabulary: 90,
        useOfExamples: 85
      }
    };
    // clarity: 80 * 0.15 = 12
    // fluency: 70 * 0.10 = 7
    // technicalVocabulary: 90 * 0.35 = 31.5
    // useOfExamples: 85 * 0.40 = 34
    // Total = 12 + 7 + 31.5 + 34 = 84.5

    const result = await handler(event);
    expect(result.overallScore).toBe(84.5);
    expect(result.hasCriticalFlaw).toBe(false);
  });

  it('should apply critical flaw penalty if a score is below threshold', async () => {
    const event = {
      moduleType: 'RESUME',
      dimensionScores: {
        clarity: 40, // Below 50
        fluency: 80,
        technicalVocabulary: 80,
        useOfExamples: 80
      }
    };
    // clarity: 40 * 0.15 = 6
    // fluency: 80 * 0.10 = 8
    // technicalVocabulary: 80 * 0.35 = 28
    // useOfExamples: 80 * 0.40 = 32
    // Weighted Sum = 6 + 8 + 28 + 32 = 74
    // Penalty (15% reduction) = 74 * 0.85 = 62.9

    const result = await handler(event);
    expect(result.overallScore).toBe(62.9);
    expect(result.hasCriticalFlaw).toBe(true);
  });

  it('should handle INTRO module weights', async () => {
    const event = {
      moduleType: 'INTRO',
      dimensionScores: {
        clarity: 100,
        structure: 100,
        confidence: 100,
        relevance: 100
      }
    };
    const result = await handler(event);
    expect(result.overallScore).toBe(100);
  });
});
