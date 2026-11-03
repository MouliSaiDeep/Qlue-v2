const DEFAULT_POLICY = require('./quality-policy.json');
function qualityGate(report, policy = DEFAULT_POLICY) {
  if (typeof policy.version !== 'string' || !policy.version ||
      !Number.isInteger(policy.minRunsPerCase) || policy.minRunsPerCase < 3 ||
      !['minValidRate', 'minRepeatWithinRangeRate'].every(k => Number.isFinite(policy[k]) && policy[k] > 0 && policy[k] <= 1) ||
      !['maxModuleMeanAbsoluteError', 'maxRepeatRange'].every(k => Number.isFinite(policy[k]) && policy[k] >= 0 && policy[k] <= 100)) {
    throw Error('INVALID_QUALITY_POLICY');
  }
  const cohorts = report.modelSummaries.map(model => {
    const runs = report.runs.filter(r => r.modelId === model.modelId);
    const validRate = runs.length ? runs.filter(r => r.status === 'VALID').length / runs.length : 0;
    const comparisons = report.comparisons.filter(c => c.modelId === model.modelId);
    const modules = Object.entries(report.preparedByModule).filter(([, count]) => count > 0).map(([module, expectedCases]) => {
      const cases = comparisons.filter(c => c.module === module);
      const complete = cases.length === expectedCases && cases.every(c => c.validRuns >= policy.minRunsPerCase && c.humanReviewers >= 2);
      const errors = cases.map(c => c.absoluteError).filter(Number.isFinite);
      const meanAbsoluteError = errors.length === expectedCases ? errors.reduce((sum, n) => sum + n, 0) / errors.length : null;
      const repeatWithinRangeRate = cases.filter(c => c.validRuns >= policy.minRunsPerCase &&
        Number.isFinite(c.repeatRange) && c.repeatRange <= policy.maxRepeatRange).length / expectedCases;
      return { module, expectedCases, complete, meanAbsoluteError, repeatWithinRangeRate,
        passed: complete && meanAbsoluteError !== null && meanAbsoluteError <= policy.maxModuleMeanAbsoluteError &&
          repeatWithinRangeRate >= policy.minRepeatWithinRangeRate };
    });
    return { modelId: model.modelId, validRate, modules,
      passed: modules.length > 0 && validRate >= policy.minValidRate && modules.every(m => m.passed) };
  });
  // This checks numerical evidence only. Human review of invented facts,
  // usefulness, consented real examples and held-out data remains a launch gate.
  return { policy, numericGatePassed: cohorts.some(c => c.passed),
    humanContentReviewRequired: true, calibrationStatus: 'NOT_HUMAN_CALIBRATED', cohorts };
}
module.exports = { qualityGate, DEFAULT_POLICY };
