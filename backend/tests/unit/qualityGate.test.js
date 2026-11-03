const { qualityGate, DEFAULT_POLICY } = require('../../evaluation/quality-gate.cjs');
const comparison = (module, changes = {}) => ({ module, modelId: 'model-a', validRuns: 3,
  humanReviewers: 2, absoluteError: 5, repeatRange: 5, ...changes });
function report(comparisons = [comparison('INTRO'), comparison('HR')]) {
  return { preparedByModule: { INTRO: 1, HR: 1 },
    modelSummaries: [{ modelId: 'model-a' }], comparisons,
    runs: Array.from({ length: 6 }, () => ({ modelId: 'model-a', status: 'VALID' })) };
}
test('complete per-module numerical evidence passes without claiming human calibration', () => {
  expect(qualityGate(report())).toMatchObject({ numericGatePassed: true,
    humanContentReviewRequired: true, calibrationStatus: 'NOT_HUMAN_CALIBRATED' });
});
test('a weak module cannot hide behind a good aggregate', () => {
  const result = qualityGate(report([comparison('INTRO', { absoluteError: 0 }), comparison('HR', { absoluteError: 15 })]));
  expect(result.numericGatePassed).toBe(false);
  expect(result.cohorts[0].modules.find(m => m.module === 'HR').meanAbsoluteError).toBe(15);
});
test.each([{ validRuns: 2 }, { humanReviewers: 1 }, { absoluteError: null }, { repeatRange: null }, { repeatRange: 11 }])(
  'incomplete or unstable results fail: %j', changes => {
    expect(qualityGate(report([comparison('INTRO', changes), comparison('HR')])).numericGatePassed).toBe(false);
  });
test('missing cases and missing model runs fail closed', () => {
  expect(qualityGate(report([comparison('INTRO')])).numericGatePassed).toBe(false);
  const empty = report(); empty.runs = []; empty.modelSummaries = [];
  expect(qualityGate(empty).numericGatePassed).toBe(false);
});
test('invalid attempts remain in the validity denominator after successful retries', () => {
  const input = report(); input.runs.push({ modelId: 'model-a', status: 'INVALID' });
  const result = qualityGate(input);
  expect(result.numericGatePassed).toBe(false); expect(result.cohorts[0].validRate).toBeCloseTo(6 / 7);
});
test('different model versions cannot combine partial coverage to pass', () => {
  const input = report([comparison('INTRO'), comparison('HR', { modelId: 'model-b' })]);
  input.modelSummaries.push({ modelId: 'model-b' });
  input.runs.push({ modelId: 'model-b', status: 'VALID' });
  expect(qualityGate(input).numericGatePassed).toBe(false);
});
test('invalid or weaker-than-three-run policy is rejected', () => {
  for (const change of [{ minRunsPerCase: 1 }, { minValidRate: NaN }, { maxRepeatRange: -1 }]) {
    expect(() => qualityGate(report(), { ...DEFAULT_POLICY, ...change })).toThrow('INVALID_QUALITY_POLICY');
  }
});
