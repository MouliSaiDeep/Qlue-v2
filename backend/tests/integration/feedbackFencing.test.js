const { DocumentBoundary } = require('../helpers/documentBoundary');
const db = require('../../src/lib/dynamodb');
const attempt = require('../../src/lib/feedbackAttempt');
const { handler: store } = require('../../src/handlers/feedback/storeFeedbackReport');
const { createFeedbackReport } = require('../../src/models/feedback');
const TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';
const REPORTS = process.env.FEEDBACK_TABLE || 'qlue-feedback';
const DELETIONS = require('../../src/lib/deletionJob').TABLE;
const event = { sessionId: 's', userId: 'owner', attemptId: 'a', analysisStatus: 'OK',
  reportVersion: 'content-rubric-v2', overallScore: 75, dimensionScores: { Relevance: 75 } };
let boundary, spy;
const row = () => boundary.get(TABLE, { sessionId: 's' });
const replace = changes => boundary.seed(TABLE, { ...row(), ...changes });
const reports = () => [...boundary.rows.values()].filter(r => r.feedbackId === 's#a' && r.generatedAt);
beforeEach(() => {
  boundary = new DocumentBoundary();
  boundary.seed(TABLE, { sessionId: 's', userId: 'owner', currentState: 'GENERATING_FEEDBACK',
    feedbackAttemptId: 'a', feedbackExpected: true, answeredCount: 1 });
  spy = jest.spyOn(db.docClient, 'send').mockImplementation(command => boundary.send(command));
});
afterEach(() => spy.mockRestore());

test.each([{ discarded: true }, { feedbackExpected: false }, { answeredCount: 0 }, { userId: 'another' }])(
  'late feedback cannot grade an ineligible or foreign session: %j', async changes => {
    replace(changes);
    expect(await store(event)).toEqual({ success: true, stale: true });
    expect(reports()).toHaveLength(0);
    expect(row()).not.toHaveProperty('feedbackId');
  });

test('discard racing the initial read prevents report creation atomically', async () => {
  let raced = false;
  boundary.beforeSend = async command => {
    if (!raced && command.input.TransactItems?.some(op => op.Put?.TableName === REPORTS)) {
      raced = true; replace({ discarded: true, feedbackExpected: false, answeredCount: 0, currentState: 'TERMINATED' });
    }
  };
  expect(await store(event)).toEqual({ success: true, stale: true });
  expect(raced).toBe(true); expect(reports()).toHaveLength(0);
  expect(row()).not.toHaveProperty('feedbackId');
});

test('replacement attempt racing promotion cannot publish the old score', async () => {
  let raced = false;
  boundary.beforeSend = async command => {
    if (!raced && command.input.TransactItems?.some(op => op.Update?.TableName === TABLE)) {
      raced = true; replace({ feedbackAttemptId: 'new', feedbackStatus: 'PENDING' });
    }
  };
  expect(await store(event)).toEqual({ success: true, stale: true });
  expect(row()).toMatchObject({ feedbackAttemptId: 'new', feedbackStatus: 'PENDING' });
  expect(row()).not.toHaveProperty('assessmentOverallScore');
});

test('promotion itself rejects a discarded parent even without an earlier read', async () => {
  replace({ discarded: true });
  await expect(attempt.promote(event, { ...event, feedbackId: 'f' })).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
  expect(row()).not.toHaveProperty('feedbackId');
});

test('direct report creation enforces ownership in its transaction', async () => {
  const result = await createFeedbackReport({ ...event, userId: 'foreign' });
  expect(result.success).toBe(false); expect(reports()).toHaveLength(0);
});

test('a late delivery for a deleted account is acknowledged without recreating data', async () => {
  boundary.seed(DELETIONS, { userId: 'owner', status: 'COMPLETE' });
  expect(await store(event)).toEqual({ success: true, stale: true });
  expect(reports()).toHaveLength(0);
});

test('duplicate delivery promotes the stored canonical score, never a conflicting retry', async () => {
  expect(await store(event)).toEqual({ success: true, feedbackId: 's#a' });
  expect(await store({ ...event, analysisStatus: 'UNAVAILABLE', overallScore: null, dimensionScores: {} }))
    .toEqual({ success: true, feedbackId: 's#a' });
  expect(reports()).toHaveLength(1);
  expect(row()).toMatchObject({ feedbackStatus: 'COMPLETE', assessmentOverallScore: 75 });
});

test.each(['create', 'promote'])('deletion racing feedback %s cannot recreate account data', async stage => {
  let raced = false;
  boundary.beforeSend = async command => {
    const operations = command.input.TransactItems || [];
    if (!raced && operations.some(op => stage === 'create' ? op.Put?.TableName === REPORTS : op.Update?.TableName === TABLE)) {
      raced = true; boundary.seed(DELETIONS, { userId: 'owner', status: 'PENDING' });
    }
  };
  expect(await store(event)).toEqual({ success: true, stale: true });
  expect(raced).toBe(true); expect(row()).not.toHaveProperty('feedbackId');
  if (stage === 'create') expect(reports()).toHaveLength(0);
});

test('legacy answered sessions without acceptance metadata still complete', async () => {
  const legacy = row(); delete legacy.answeredCount; delete legacy.feedbackExpected;
  boundary.seed(TABLE, legacy);
  expect(await store(event)).toEqual({ success: true, feedbackId: 's#a' });
});

test('storage outages remain retryable rather than being acknowledged as stale', async () => {
  boundary.beforeSend = async command => {
    if (command.input.TransactItems) throw Object.assign(Error('storage unavailable'), { name: 'AccessDeniedException' });
  };
  await expect(store(event)).rejects.toMatchObject({ name: 'AccessDeniedException' });
  expect(row()).not.toHaveProperty('feedbackId');
});

test('legacy jobs without attempt metadata keep their existing compatibility path', async () => {
  const legacy = row(); delete legacy.feedbackAttemptId;
  boundary.seed(TABLE, legacy);
  const payload = { ...event }; delete payload.attemptId;
  expect(await store(payload)).toEqual({ success: true, feedbackId: 's#content-rubric-v2' });
});
