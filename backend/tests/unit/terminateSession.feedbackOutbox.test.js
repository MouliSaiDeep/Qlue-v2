const { handler } = require('../../src/handlers/interview/terminateSession');
const { getSessionById, updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { getTranscriptBySession } = require('../../src/models/transcript');
const { publishFeedbackJob, FEEDBACK_JOB, DISPATCH_MARKER } = require('../../src/lib/feedbackDispatch');

jest.mock('../../src/models/session');
jest.mock('../../src/models/transcript');
// Keep the real outbox constants/helpers; stub ONLY the SNS publish so each test
// can drive publish success/failure deterministically without a live topic.
jest.mock('../../src/lib/feedbackDispatch', () => {
  const actual = jest.requireActual('../../src/lib/feedbackDispatch');
  return { ...actual, publishFeedbackJob: jest.fn() };
});

const conditionalError = () => {
  const e = new Error('The conditional request failed');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

// R-05: feedback used to be lost when a session entered GENERATING_FEEDBACK but
// the SNS publish failed (or the Lambda died right after the transition): the
// session wedged, and every retry hit the "already in progress" guard and
// returned success WITHOUT ever publishing. These tests assert the durable
// outbox: the job is persisted atomically with the transition, a failed publish
// leaves it PENDING (never silently dropped, never 500), and a racing duplicate
// terminate RE-DISPATCHES the pending job.
describe('terminateSession feedback outbox (R-05)', () => {
  const userId = 'u-1';
  const sessionId = 's-1';
  const event = (reason = 'USER_QUIT') => ({
    requestContext: { authorizer: { uid: userId } },
    body: JSON.stringify({ sessionId, reason })
  });
  const terminateCalls = () =>
    updateSessionState.mock.calls.filter(([, to]) => to === INTERVIEW_STATES.TERMINATED);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FEEDBACK_TOPIC_ARN = 'arn:aws:sns:region:acct:feedback';
    getTranscriptBySession.mockResolvedValue([{ speaker: 'USER', text: 'a real answer' }]);
    updateSessionState.mockResolvedValue({});
  });

  test('writes the PENDING outbox job + dispatch marker ATOMICALLY with the GENERATING_FEEDBACK claim', async () => {
    getSessionById.mockResolvedValue({ userId, sessionId, moduleType: 'HR', currentState: INTERVIEW_STATES.AI_SPEAKING });
    publishFeedbackJob.mockResolvedValue({ published: true });

    const result = await handler(event('USER_QUIT'));

    // The claim transition and the outbox entry are one and the same conditional
    // write — a single-item update is inherently atomic.
    expect(updateSessionState).toHaveBeenCalledWith(
      sessionId,
      INTERVIEW_STATES.GENERATING_FEEDBACK,
      INTERVIEW_STATES.AI_SPEAKING,
      expect.objectContaining({
        terminationReason: 'USER_QUIT',
        feedbackDispatchPending: DISPATCH_MARKER,
        feedbackJob: expect.objectContaining({
          status: FEEDBACK_JOB.PENDING,
          attempts: 0,
          payload: { sessionId, userId, moduleType: 'HR', reason: 'USER_QUIT', attemptId:`initial-${sessionId}` }
        })
      })
    );
    // Published → finalized to TERMINATED (which drops the sparse marker).
    expect(terminateCalls()).toHaveLength(1);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).state).toBe(INTERVIEW_STATES.TERMINATED);
  });

  test('a failed publish leaves the job PENDING (never TERMINATED, never 500) so it stays recoverable', async () => {
    getSessionById.mockResolvedValue({ userId, sessionId, moduleType: 'HR', currentState: INTERVIEW_STATES.AI_SPEAKING });
    publishFeedbackJob.mockRejectedValue(new Error('SNS throttled'));

    const result = await handler(event('USER_QUIT'));

    // The claim still happened (job persisted PENDING before the publish attempt).
    expect(updateSessionState).toHaveBeenCalledWith(
      sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.AI_SPEAKING,
      expect.objectContaining({ feedbackDispatchPending: DISPATCH_MARKER })
    );
    // The job is re-stamped PENDING with the failure recorded, CONDITIONAL on the
    // row still being in GENERATING_FEEDBACK — keeping it in the dispatch index.
    expect(updateSessionState).toHaveBeenCalledWith(
      sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.GENERATING_FEEDBACK,
      expect.objectContaining({
        feedbackDispatchPending: DISPATCH_MARKER,
        feedbackJob: expect.objectContaining({ status: FEEDBACK_JOB.PENDING, attempts: 1, lastError: expect.any(String) })
      })
    );
    // CRITICAL regression: the session is NOT advanced to TERMINATED on a failed
    // publish — doing so (plus the idempotency guard) is what dropped feedback.
    expect(terminateCalls()).toHaveLength(0);
    // And the terminate does not 500 — the client is acknowledged; the backstop
    // dispatcher / duplicate terminate will complete delivery.
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).feedbackPending).toBe(true);
  });

  test('a racing duplicate terminate RE-DISPATCHES a still-PENDING job (the real-world recovery)', async () => {
    // WS + REST both fire on end. The first attempt failed to publish and left
    // the job PENDING; this second terminate observes GENERATING_FEEDBACK with a
    // PENDING outbox and must publish it rather than return a hollow success.
    getSessionById.mockResolvedValue({
      userId, sessionId, moduleType: 'HR',
      currentState: INTERVIEW_STATES.GENERATING_FEEDBACK,
      feedbackJob: { status: FEEDBACK_JOB.PENDING, attempts: 1, payload: { sessionId, userId, moduleType: 'HR', reason: 'USER_QUIT' } }
    });
    publishFeedbackJob.mockResolvedValue({ published: true });

    const result = await handler(event('IGNORED_ON_RECOVERY'));

    // It published the ORIGINAL stored payload (not a freshly derived one).
    expect(publishFeedbackJob).toHaveBeenCalledWith({ sessionId, userId, moduleType: 'HR', reason: 'USER_QUIT' });
    expect(terminateCalls()).toHaveLength(1); // finalized after a successful re-publish
    const body = JSON.parse(result.body);
    expect(body.recovered).toBe(true);
    expect(body.state).toBe(INTERVIEW_STATES.TERMINATED);
  });

  test('recovery that still cannot publish bumps the attempt count and keeps the job PENDING', async () => {
    getSessionById.mockResolvedValue({
      userId, sessionId, moduleType: 'HR',
      currentState: INTERVIEW_STATES.GENERATING_FEEDBACK,
      feedbackJob: { status: FEEDBACK_JOB.PENDING, attempts: 2, payload: { sessionId, userId, moduleType: 'HR', reason: 'USER_QUIT' } }
    });
    publishFeedbackJob.mockRejectedValue(new Error('still down'));

    const result = await handler(event());

    expect(updateSessionState).toHaveBeenCalledWith(
      sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK, INTERVIEW_STATES.GENERATING_FEEDBACK,
      expect.objectContaining({ feedbackJob: expect.objectContaining({ status: FEEDBACK_JOB.PENDING, attempts: 3 }) })
    );
    expect(terminateCalls()).toHaveLength(0);
    expect(JSON.parse(result.body).feedbackPending).toBe(true);
  });

  test('a legacy GENERATING_FEEDBACK row with no outbox job stays an idempotent no-op (no double publish)', async () => {
    getSessionById.mockResolvedValue({ userId, sessionId, moduleType: 'HR', currentState: INTERVIEW_STATES.GENERATING_FEEDBACK });

    const result = await handler(event());

    expect(publishFeedbackJob).not.toHaveBeenCalled();
    expect(updateSessionState).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).message).toBe('Feedback already in progress');
  });

  test('a conditional loss on the claim does not publish (single-winner)', async () => {
    getSessionById.mockResolvedValue({ userId, sessionId, moduleType: 'HR', currentState: INTERVIEW_STATES.AI_SPEAKING });
    updateSessionState.mockRejectedValueOnce(conditionalError()); // another path already claimed
    getSessionById.mockResolvedValueOnce({userId,sessionId,moduleType:'HR',currentState:INTERVIEW_STATES.AI_SPEAKING})
      .mockResolvedValue({userId,sessionId,moduleType:'HR',currentState:INTERVIEW_STATES.GENERATING_FEEDBACK});

    const result = await handler(event());

    expect(publishFeedbackJob).not.toHaveBeenCalled();
    expect(terminateCalls()).toHaveLength(0);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toBe('Termination already in progress');
  });
});
