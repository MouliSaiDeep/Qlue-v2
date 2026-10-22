const { evaluate, prepareCase, fingerprint } = require('../../evaluation/evaluate.cjs');
const corpus = require('../../evaluation/cases.cjs');
const assessment = require('../../src/lib/feedbackAssessment');

test('launch corpus covers every module and rejects missing owned context without claiming calibration', () => {
  const report = evaluate();
  expect(report.totalCases).toBe(100);
  expect(Object.values(report.casesByModule)).toEqual([20, 20, 20, 20, 20]);
  expect(report.preparedCases).toBe(98);
  expect(report.invalidInputs).toHaveLength(2);
  expect(report.calibrationStatus).toBe('NOT_HUMAN_CALIBRATED');
  expect(report.meanAbsoluteError).toBeNull();
});

test('model records cannot silently reuse an earlier prompt or duplicate a repeat', () => {
  const c = corpus.cases.find(c => c.id === 'resume-launch-1-1'), p = prepareCase(c);
  const record = { caseId: c.id, repeat: 1, modelId: 'synthetic-model', rubricVersion: assessment.VERSION,
    requestSha256: fingerprint(p), response: {} };
  expect(() => evaluate({ cases: [c], outputs: [{ ...record, requestSha256: 'stale' }] })).toThrow('STALE_MODEL_RECORD');
  expect(() => evaluate({ cases: [c], outputs: [record, record] })).toThrow('DUPLICATE_MODEL_RUN');
  expect(evaluate({ cases: [c], outputs: [record] }).invalidModelRuns).toBe(1);
});

test('human grading requires real completed rubric levels and distinct reviewer identities', () => {
  const c = corpus.cases.find(c => c.id === 'resume-launch-1-1'), p = prepareCase(c);
  const review = { caseId: c.id, reviewerId: 'one', requestSha256: fingerprint(p), answers: [{ answerId: p.answers[0].answerId,
    levels: Object.fromEntries(p.rubric.map(r => [r.id, 3])) }] };
  expect(() => evaluate({ cases: [c], human: [review, review] })).toThrow('DUPLICATE_REVIEWER');
  const report = evaluate({ cases: [c], human: [review, { ...review, reviewerId: 'two' }] });
  expect(report.casesWithTwoHumanReviewers).toBe(1);
  expect(report.calibrationStatus).toBe('NOT_HUMAN_CALIBRATED');
  expect(() => evaluate({ cases: [c], human: [{ ...review, answers: [{ answerId: 'wrong', levels: {} }] }] })).toThrow();
});

test('repeatability and human error remain separate for different model cohorts', () => {
  const c = corpus.cases.find(c => c.id === 'resume-launch-1-1'), p = prepareCase(c), answerId = p.answers[0].answerId;
  const response = level => ({ answers: [{ answerId, criteria: Object.fromEntries(p.rubric.map(r => [r.id, {
    level, evidenceId: 'e1', reason: 'The explanation provides relevant support for the requested criterion.' }])) }],
    coaching: { summary: 'Your explanation connects the operation identifier with safe handling of repeated requests. This review evaluates the content supplied in this answer.',
      criteria: p.rubric.map(r => ({ criterionId: r.id, answerId, evidenceId: 'e1',
        strength: 'You explain the relationship between a repeated request and its saved operation result.',
        gap: '', nextStep: '', reason: 'The cited explanation supplies relevant information for this criterion.' })) } });
  const record = (repeat, level, modelId = 'model-a') => ({ caseId: c.id, repeat, modelId, rubricVersion: assessment.VERSION,
    requestSha256: fingerprint(p), response: response(level) });
  const review = (reviewerId, level) => ({ caseId: c.id, reviewerId, requestSha256: fingerprint(p),
    answers: [{ answerId, levels: Object.fromEntries(p.rubric.map(r => [r.id, level])) }] });
  const report = evaluate({ cases: [c], outputs: [record(1, 3), record(2, 4), record(3, 3), record(1, 4, 'model-b')],
    human: [review('one', 3), review('two', 4)] });
  expect(report.invalidModelRuns).toBe(0);
  expect(report.modelSummaries).toHaveLength(2);
  expect(report.comparisons.find(c => c.modelId === 'model-a').repeatRange).toBe(25);
  expect(report.comparisons.find(c => c.modelId === 'model-a').humanDisagreement).toBe(25);
  expect(report.modelSummaries.find(c => c.modelId === 'model-a').meanAbsoluteError).toBeCloseTo(4.1666667);
  expect(report.modelSummaries.find(c => c.modelId === 'model-b').casesWithThreeRuns).toBe(0);
  expect(report.meanAbsoluteError).toBeNull();
});
