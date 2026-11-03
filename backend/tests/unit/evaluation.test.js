const { evaluate, prepareCase, fingerprint, exportBundle } = require('../../evaluation/evaluate.cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const corpus = require('../../evaluation/cases.cjs');
const assessment = require('../../src/lib/feedbackAssessment');

test('review preparation produces blank blind forms and never overwrites completed grades', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qlue-blind-review-'));
  try {
    expect(exportBundle(directory)).toEqual({ requests: 98, humanForms: 196, providerCalls: 0 });
    const file = path.join(directory, 'reviewer-1.json');
    const forms = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(forms).toHaveLength(98);
    expect(Object.values(forms[0].answers[0].levels).every(level => level === null)).toBe(true);
    forms[0].answers[0].notes = 'Completed independent review';
    const completed = JSON.stringify(forms); fs.writeFileSync(file, completed);
    expect(() => exportBundle(directory)).toThrow('REVIEW_BUNDLE_EXISTS');
    expect(fs.readFileSync(file, 'utf8')).toBe(completed);
  } finally {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('qlue-blind-review-')) throw Error('Unsafe review fixture cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('launch corpus covers every module and rejects missing owned context without claiming calibration', () => {
  const report = evaluate();
  expect(report.totalCases).toBe(100);
  expect(Object.values(report.casesByModule)).toEqual([20, 20, 20, 20, 20]);
  expect(report.preparedCases).toBe(98);
  expect(report.invalidInputs).toHaveLength(2);
  expect(report.calibrationStatus).toBe('NOT_HUMAN_CALIBRATED');
  expect(report.meanAbsoluteError).toBeNull();
});

test('WEBSITE review records use the actual saved-guide production prompt and reject missing guides',()=>{
 const c=corpus.cases.find(c=>c.id==='website-launch-5-1'),g=require('../../src/lib/websiteGradingGuide');
 const key=g.hash(JSON.stringify([g.VERSION,c.question,c.assessmentContext.text]));
 const guides={[key]:{version:g.VERSION,questionSha256:g.hash(c.question),sourceSha256:g.hash(g.sourceText(c.assessmentContext.text)),applicationRequested:false,
  points:[{id:'p1',quote:'Randomized controlled experiments help estimate causal effects.',kind:'RELATIONSHIP'}]}};
 const p=prepareCase(c,{guides});expect(p.answers[0].websiteGradingGuide).toEqual(guides[key]);
 expect(JSON.parse(assessment.prompt(p).outputConfig.textFormat.structure.jsonSchema.schema).properties.websiteChecks).toBeDefined();
 const response={websiteChecks:{answer_1:{clarity:{status:'CLEAR',evidenceId:'e1'},p1:{status:'PARTIAL',evidenceId:'e1'}}}};
 const record={caseId:c.id,repeat:1,modelId:'controlled',rubricVersion:assessment.VERSION,requestSha256:fingerprint(p),response};
 expect(evaluate({cases:[c],outputs:[record],guides}).invalidModelRuns).toBe(0);
 expect(()=>evaluate({cases:[c],outputs:[record]})).toThrow('STALE_MODEL_RECORD');
 expect(()=>prepareCase(c,{guides:{}})).toThrow('REVIEW_GUIDE_MISSING');
});

test('model records cannot silently reuse an earlier prompt or duplicate a repeat', () => {
  const c = corpus.cases.find(c => c.id === 'resume-launch-1-1'), p = prepareCase(c);
  const record = { caseId: c.id, repeat: 1, modelId: 'synthetic-model', rubricVersion: assessment.VERSION,
    requestSha256: fingerprint(p), response: {} };
  expect(() => evaluate({ cases: [c], outputs: [{ ...record, requestSha256: 'stale' }] })).toThrow('STALE_MODEL_RECORD');
  expect(() => evaluate({ cases: [c], outputs: [record, record] })).toThrow('DUPLICATE_MODEL_RUN');
  expect(() => evaluate({ cases: [c], outputs: [record, { ...record, modelId: ' synthetic-model ' }] })).toThrow('DUPLICATE_MODEL_RUN');
  expect(evaluate({ cases: [c], outputs: [record] }).invalidModelRuns).toBe(1);
});

test('human grading requires real completed rubric levels and distinct reviewer identities', () => {
  const c = corpus.cases.find(c => c.id === 'resume-launch-1-1'), p = prepareCase(c);
  const review = { caseId: c.id, reviewerId: 'one', requestSha256: fingerprint(p), answers: [{ answerId: p.answers[0].answerId,
    levels: Object.fromEntries(p.rubric.map(r => [r.id, 3])) }] };
  expect(() => evaluate({ cases: [c], human: [review, review] })).toThrow('DUPLICATE_REVIEWER');
  expect(() => evaluate({ cases: [c], human: [review, { ...review, reviewerId: ' one ' }] })).toThrow('DUPLICATE_REVIEWER');
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
