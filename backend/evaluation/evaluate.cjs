const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assessment = require('../src/lib/feedbackAssessment');
const corpus = require('./cases.cjs');

function prepareCase(testCase) {
  const event = { moduleType: testCase.module, assessmentContext: testCase.assessmentContext,
    answerPairs: testCase.answers.map((answer, i) => ({ answerId: `${testCase.id}-${i + 1}`, question: testCase.question, answer })) };
  return assessment.prepare(event);
}
function fingerprint(prepared) {
  return createHash('sha256').update(JSON.stringify(assessment.prompt(prepared))).digest('hex');
}
function evaluate({ cases = corpus.cases, outputs = [], human = [] } = {}) {
  const prepared = new Map(), invalidInputs = [], ids = new Set();
  for (const c of cases) {
    if (ids.has(c.id)) throw Error('DUPLICATE_CASE');
    ids.add(c.id);
    try { prepared.set(c.id, { testCase: c, value: prepareCase(c) }); }
    catch (error) {
      if (c.caseType !== 'missing-context' || error.code !== 'CONTEXT_UNAVAILABLE') throw error;
      invalidInputs.push({ caseId: c.id, expectedRejection: error.code });
    }
  }
  const runs = [], seen = new Set();
  for (const output of outputs) {
    const c = prepared.get(output.caseId);
    if (!c || !Number.isSafeInteger(output.repeat) || output.repeat < 1 || typeof output.modelId !== 'string' || !output.modelId.trim()) throw Error('INVALID_MODEL_RECORD');
    const key = `${output.modelId}:${output.caseId}:${output.repeat}`;
    if (seen.has(key)) throw Error('DUPLICATE_MODEL_RUN');
    seen.add(key);
    // Reject stale requests/results after any rubric or prompt change.
    if (output.requestSha256 !== fingerprint(c.value) || output.rubricVersion !== assessment.VERSION) throw Error('STALE_MODEL_RECORD');
    try {
      const raw = typeof output.response === 'string' ? output.response : JSON.stringify(output.response);
      const report = assessment.report(c.value, assessment.validate(raw, c.value, { requireCoaching: true }));
      runs.push({ caseId: output.caseId, repeat: output.repeat, modelId: output.modelId,
        score: report.overallScore, status: 'VALID', levels: report.assessment.answers.map(a => a.levels) });
    } catch (error) {
      runs.push({ caseId: output.caseId, repeat: output.repeat, modelId: output.modelId, status: 'INVALID', reason: error.code || 'INVALID_ASSESSMENT' });
    }
  }
  const reviews = new Map(), reviewerKeys = new Set();
  for (const row of human) {
    const blindIndex = /^review-(\d{3})$/.exec(row.caseId || '');
    const caseId = blindIndex ? cases[Number(blindIndex[1]) - 1]?.id : row.caseId;
    const c = prepared.get(caseId);
    if (!c || typeof row.reviewerId !== 'string' || !row.reviewerId.trim() || !Array.isArray(row.answers)) throw Error('INVALID_HUMAN_REVIEW');
    if (row.requestSha256 !== fingerprint(c.value)) throw Error('STALE_HUMAN_REVIEW');
    const key = `${caseId}:${row.reviewerId}`;
    if (reviewerKeys.has(key)) throw Error('DUPLICATE_REVIEWER');
    reviewerKeys.add(key);
    const expected = c.value.module === 'INTRO' ? [c.value.answers.at(-1)] : c.value.answers;
    if (row.answers.length !== expected.length || new Set(row.answers.map(a => a.answerId)).size !== expected.length) throw Error('INVALID_HUMAN_ANSWERS');
    let score = 0;
    for (const [answerIndex, answer] of expected.entries()) {
      const rated = row.answers.find(a => a.answerId === (blindIndex ? 'answer-' + (answerIndex + 1) : answer.answerId));
      if (!rated?.levels || Object.keys(rated.levels).sort().join() !== c.value.rubric.map(r => r.id).sort().join()) throw Error('INVALID_HUMAN_LEVELS');
      score += c.value.rubric.reduce((sum, r) => {
        const n = rated.levels[r.id];
        if (!Number.isInteger(n) || n < 0 || n > 4) throw Error('INVALID_HUMAN_LEVELS');
        return sum + r.weight * n / 4;
      }, 0) / expected.length;
    }
    const entries = reviews.get(caseId) || [];
    entries.push(score); reviews.set(caseId, entries);
  }
  const comparisons = [];
  for (const [caseId, c] of prepared) {
    const ratings = reviews.get(caseId) || [], humanMean = ratings.length >= 2 ? ratings.reduce((s, n) => s + n, 0) / ratings.length : null;
    // Keep different model versions separate; never call cross-model drift repeatability.
    for (const modelId of new Set(runs.filter(r => r.caseId === caseId).map(r => r.modelId))) {
      const valid = runs.filter(r => r.caseId === caseId && r.modelId === modelId && r.status === 'VALID');
      const scores = valid.map(r => r.score), mean = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null;
      comparisons.push({ caseId, module: c.value.module, modelId, validRuns: scores.length,
        repeatRange: scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : null,
        modelMean: mean, humanReviewers: ratings.length, humanMean,
        humanDisagreement: ratings.length >= 2 ? Math.max(...ratings) - Math.min(...ratings) : null,
        absoluteError: mean !== null && humanMean !== null ? Math.abs(mean - humanMean) : null });
    }
  }
  const errors = comparisons.map(c => c.absoluteError).filter(n => n !== null);
  const modelSummaries = [...new Set(runs.map(r => r.modelId))].map(modelId => {
    const groups = comparisons.filter(c => c.modelId === modelId), errors = groups.map(c => c.absoluteError).filter(n => n !== null);
    return { modelId, casesWithValidRuns: groups.filter(c => c.validRuns > 0).length,
      casesWithThreeRuns: groups.filter(c => c.validRuns >= 3).length, comparedCases: errors.length,
      meanAbsoluteError: errors.length ? errors.reduce((s, n) => s + n, 0) / errors.length : null };
  });
  return { corpusVersion: corpus.version, rubricVersion: assessment.VERSION, syntheticOnly: true,
    calibrationStatus: 'NOT_HUMAN_CALIBRATED', totalCases: cases.length, preparedCases: prepared.size,
    casesByModule: Object.fromEntries(Object.keys(assessment.RUBRICS).map(m => [m, cases.filter(c => c.module === m).length])),
    casesWithTwoHumanReviewers: [...reviews.values()].filter(r => r.length >= 2).length,
    modelRuns: runs.length, invalidModelRuns: runs.filter(r => r.status === 'INVALID').length,
    meanAbsoluteError: modelSummaries.length === 1 && errors.length ? errors.reduce((s, n) => s + n, 0) / errors.length : null,
    modelSummaries, invalidInputs, runs, comparisons };
}

function exportBundle(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const requests = [], reviews = [];
  for (const [index, c] of corpus.cases.entries()) {
    let prepared;
    try { prepared = prepareCase(c); } catch (error) { if (c.caseType === 'missing-context' && error.code === 'CONTEXT_UNAVAILABLE') continue; throw error; }
    requests.push({ caseId: c.id, module: c.module, rubricVersion: assessment.VERSION, requestSha256: fingerprint(prepared),
      request: assessment.prompt(prepared), responseRecord: { caseId: c.id, repeat: 1, modelId: null,
        rubricVersion: assessment.VERSION, requestSha256: fingerprint(prepared), response: null } });
    const answers = prepared.module === 'INTRO' ? [prepared.answers.at(-1)] : prepared.answers;
    // Separate blind review files exclude model outputs and construction labels.
    for (const reviewerId of ['reviewer-1', 'reviewer-2']) reviews.push({ caseId: 'review-' + String(index + 1).padStart(3, '0'),
      reviewerId, requestSha256: fingerprint(prepared), module: c.module,
      context: c.assessmentContext, rubric: prepared.rubric, answers: answers.map((a, i) => ({ answerId: 'answer-' + (i + 1),
        question: a.question, answer: a.text, levels: Object.fromEntries(prepared.rubric.map(r => [r.id, null])), notes: '' })) });
  }
  fs.writeFileSync(path.join(directory, 'requests.json'), JSON.stringify(requests, null, 2) + '\n');
  for (const reviewerId of ['reviewer-1', 'reviewer-2']) fs.writeFileSync(path.join(directory, reviewerId + '.json'), JSON.stringify(reviews.filter(r => r.reviewerId === reviewerId), null, 2) + '\n');
  return { requests: requests.length, humanForms: reviews.length, providerCalls: 0 };
}
if (require.main === module) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--require-human') { options.requireHuman = true; continue; }
    if (!['--export', '--results', '--human'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Use --export DIR --results FILE --human FILE --require-human');
    options[args[i].slice(2)] = args[++i];
  }
  const exported = options.export ? exportBundle(options.export) : undefined;
  const report = evaluate({ outputs: options.results ? JSON.parse(fs.readFileSync(options.results, 'utf8')) : [],
    human: options.human ? JSON.parse(fs.readFileSync(options.human, 'utf8')) : [] });
  console.log(JSON.stringify({ ...report, ...(exported ? { exported } : {}) }, null, 2));
  if (report.invalidModelRuns || (options.requireHuman && (report.casesWithTwoHumanReviewers < report.preparedCases ||
    !report.modelSummaries.some(m => m.casesWithThreeRuns === report.preparedCases && m.comparedCases === report.preparedCases)))) process.exitCode = 1;
}
module.exports = { prepareCase, fingerprint, evaluate, exportBundle };
