const { createSession, getActiveSessionForUser, INTERVIEW_STATES } = require('../../src/models/session');
const { getUserById } = require('../../src/models/user');
const { getResumeById } = require('../../src/models/resume');
const { reserveQuota, refundQuota, getUserTier, isPremiumVoiceAllowed, assertServiceEnabled, assertAccountActive } = require('../../src/lib/quota');
const { QlueError } = require('../../src/lib/errors');
const { handler } = require('../../src/handlers/interview/initializeSession');

jest.mock('../../src/models/session');
jest.mock('../../src/models/user');
jest.mock('../../src/models/resume');
jest.mock('../../src/lib/audioHost',()=>({wake:jest.fn()}));
jest.mock('../../src/lib/quota', () => ({
  ACTIONS: { INTERVIEW: 'interview' },
  getUserTier: jest.fn(() => 'free'),
  isPremiumVoiceAllowed: jest.fn(() => true),
  reserveQuota: jest.fn(),
  refundQuota: jest.fn().mockResolvedValue(undefined),
  // R-02 admission control: a no-op by default (service enabled); the stop-switch
  // test below makes it throw to assert the hard cutoff.
  assertServiceEnabled: jest.fn(),
  // R-03 account-deletion gate: a no-op by default (account active); the
  // deleting-account test below makes it throw to assert new sessions are refused.
  assertAccountActive: jest.fn()
}));
jest.mock('../../src/handlers/interview/terminateSession', () => ({
  handler: jest.fn().mockResolvedValue({ statusCode: 200 })
}));

describe('initializeSession handler', () => {
  afterEach(()=>{delete process.env.AUDIO_HOST_WAKE_FUNCTION;});
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBSOCKET_ENDPOINT = 'https://api.example.com';
    // Default: a fresh caller under the daily cap, no active session, owning a
    // parsed resume. I-10 made RESUME/JD require an owned+parsed resume, so the
    // resume mock is part of the happy-path baseline.
    getUserById.mockResolvedValue({ voiceId: 'Ruth' });
    getActiveSessionForUser.mockResolvedValue(null);
    getResumeById.mockResolvedValue({ resumeId: 'resume-1', userId: 'user123', status: 'PARSED', parsedData: { name: 'Test', skills: ['node'] } });
    getUserTier.mockReturnValue('free');
    isPremiumVoiceAllowed.mockReturnValue(true);
    reserveQuota.mockResolvedValue({ allowed: true, used: 1, limit: 10, remaining: 9 });
    createSession.mockResolvedValue(true);
  });

  it('unverified identity consumes no quota, session or account reads', async () => {
    const result=await handler({requestContext:{authorizer:{uid:'user123',emailVerified:false}},body:JSON.stringify({moduleType:'INTRO'})});
    expect(result.statusCode).toBe(403);expect(reserveQuota).not.toHaveBeenCalled();expect(createSession).not.toHaveBeenCalled();expect(getUserById).not.toHaveBeenCalled();
  });

  it('should return 401 if userId is missing', async () => {
    const event = {
      body: JSON.stringify({}),
      requestContext: { authorizer: {emailVerified: true, } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    // No quota is consumed for an unauthenticated caller.
    expect(reserveQuota).not.toHaveBeenCalled();
  });

  it('returns 503 and spends nothing when the interview stop switch is engaged (R-02)', async () => {
    // Ops can hard-halt interview spend without a redeploy. The admission check
    // runs before any read, quota reservation, or session creation.
    assertServiceEnabled.mockImplementationOnce(() => {
      throw new QlueError('Interviews are temporarily paused.', 'SERVICE_PAUSED', 503);
    });

    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body).error).toBe('SERVICE_PAUSED');
    expect(reserveQuota).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('returns 409 and spends nothing when the account is being deleted (R-03)', async () => {
    // A session init racing an account wipe must be refused — otherwise it would
    // re-create session/lock rows that outlive the teardown. The gate runs after
    // loading the profile but before any quota reservation or session creation.
    assertAccountActive.mockImplementationOnce(() => {
      throw new QlueError('Your account is being deleted and can no longer be used.', 'ACCOUNT_DELETING', 409);
    });

    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('ACCOUNT_DELETING');
    expect(reserveQuota).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('should create a new session successfully', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue(null);
    createSession.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessionId).toBeDefined();
    expect(body.wsUrl).toBe('wss://api.example.com');
    expect(createSession).toHaveBeenCalled();
    // Additive usage block for the client.
    expect(body.usage).toEqual({ interviewsUsed: 1, interviewsLimit: 10, interviewsRemaining: 9 });
    expect(reserveQuota).toHaveBeenCalledWith('user123', 'interview', 'free');
  });
  it('prewarms only an admitted owned session, without making audio readiness block initialization',async()=>{
    process.env.AUDIO_HOST_WAKE_FUNCTION='private-wake';
    const wake=require('../../src/lib/audioHost').wake;wake.mockResolvedValue({queued:true});
    const event={requestContext:{authorizer:{uid:'user123',emailVerified:true}},body:JSON.stringify({moduleType:'INTRO'})};
    const result=await handler(event);expect(result.statusCode).toBe(200);
    expect(wake).toHaveBeenCalledWith('user123',JSON.parse(result.body).sessionId,{background:true});
    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(wake.mock.invocationCallOrder[0]);
    wake.mockClear();reserveQuota.mockResolvedValue({allowed:false,used:10,limit:10,remaining:0});
    expect((await handler(event)).statusCode).toBe(429);expect(wake).not.toHaveBeenCalled();
  });
  it('a failed best-effort prewarm preserves the created session and its quota',async()=>{
    process.env.AUDIO_HOST_WAKE_FUNCTION='private-wake';require('../../src/lib/audioHost').wake.mockRejectedValue(Error('unavailable'));
    const result=await handler({requestContext:{authorizer:{uid:'user123',emailVerified:true}},body:JSON.stringify({moduleType:'INTRO'})});
    expect(result.statusCode).toBe(200);expect(refundQuota).not.toHaveBeenCalled();
  });

  it('should return 429 when the daily interview quota is exhausted', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue(null);
    reserveQuota.mockResolvedValue({ allowed: false, used: 10, limit: 10, remaining: 0 });

    const result = await handler(event);

    expect(result.statusCode).toBe(429);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('QUOTA_EXCEEDED');
    expect(body.usage.interviewsRemaining).toBe(0);
    // A blocked reservation never creates a session and needs no refund.
    expect(createSession).not.toHaveBeenCalled();
    expect(refundQuota).not.toHaveBeenCalled();
  });

  it.each([{principalId:'verified-owner',emailVerified:true},{claims:{sub:'verified-owner',email_verified:'true'}}])('provider work and interview quota use the same verified owner %j',async authorizer=>{
    createSession.mockImplementationOnce(async()=>{
      expect(require('../../src/lib/deadline').current().userId).toBe('verified-owner');
      return true;
    });
    const result=await handler({requestContext:{authorizer},body:JSON.stringify({moduleType:'INTRO',userId:'forged-owner'})});
    expect(result.statusCode).toBe(200);
    expect(reserveQuota).toHaveBeenCalledWith('verified-owner','interview','free');
  });

  it('should return 409 if an active session already exists (no quota consumed)', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue({ sessionId: 'existing-session', userId: 'user123' });

    const result = await handler(event);

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('ConcurrentSessionError');
    // The concurrency pre-check runs before quota reservation.
    expect(reserveQuota).not.toHaveBeenCalled();
  });

  it('should force terminate existing session if force flag is provided', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1', force: true }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue({ sessionId: 'existing-session', userId: 'user123' });
    createSession.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const terminateSession = require('../../src/handlers/interview/terminateSession');
    expect(terminateSession.handler).toHaveBeenCalled();
  });

  it('should pin the neural engine when the tier disallows premium voice', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1', voiceMode: 'premium', engine: 'generative' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue(null);
    isPremiumVoiceAllowed.mockReturnValue(false); // e.g. a future gated tier
    createSession.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    // itemData is the 4th arg to createSession(sessionId, userId, moduleType, itemData)
    const itemData = createSession.mock.calls[0][3];
    expect(itemData.voiceMode).toBe('cost_saver');
    expect(itemData.engine).toBe('neural');
  });

  it('should refund the reserved slot when session creation fails', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    getActiveSessionForUser.mockResolvedValue(null);
    createSession.mockRejectedValue(new Error('DDB down'));

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(refundQuota).toHaveBeenCalledWith('user123', 'interview');
  });

  it('returns 409 with activeSessionId (and refunds) when the atomic lock loses a race', async () => {
    // The pre-check sees no active session, but a concurrent init wins the
    // atomic createSession lock. I-06: the race-path 409 must still carry
    // activeSessionId so the client can offer "end existing & retry".
    getActiveSessionForUser
      .mockResolvedValueOnce(null)                                              // pre-check: clear
      .mockResolvedValueOnce({ sessionId: 'winner-session', userId: 'user123' }); // re-query after conflict
    createSession.mockRejectedValue(Object.assign(new Error('locked'), { code: 'ACTIVE_SESSION_EXISTS' }));

    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('ConcurrentSessionError');
    expect(body.activeSessionId).toBe('winner-session');
    // The reserved slot is refunded — the race loser never ran an interview.
    expect(refundQuota).toHaveBeenCalledWith('user123', 'interview');
  });

  // ---- I-10: one canonical module contract — allowlist, resume prerequisites,
  // JD<->resume binding, and the profile snapshot, all validated BEFORE quota ----

  it('normalizes the legacy SELF_INTRO alias to the canonical INTRO module', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'SELF_INTRO' }), // INTRO needs no resume
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    // 3rd positional arg to createSession(sessionId, userId, moduleType, itemData)
    expect(createSession.mock.calls[0][2]).toBe('INTRO');
    // INTRO carries no resume, so the resume table is never read.
    expect(getResumeById).not.toHaveBeenCalled();
  });

  it('rejects an unknown module type with 400 before consuming quota', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'TOTALLY_FAKE' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('INVALID_MODULE_TYPE');
    expect(reserveQuota).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
  it('rejects a RESUME interview with no resumeId (400) and never spends a slot', async () => {
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('RESUME_REQUIRED');
    expect(reserveQuota).not.toHaveBeenCalled();
  });

  it('rejects a RESUME interview whose resume is still parsing (400 RESUME_NOT_READY)', async () => {
    getResumeById.mockResolvedValue({ resumeId: 'resume-1', userId: 'user123', status: 'PARSING' });
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('RESUME_NOT_READY');
    expect(reserveQuota).not.toHaveBeenCalled();
  });

  it('refuses a resumeId owned by another user (403) before any quota spend', async () => {
    getResumeById.mockResolvedValue({ resumeId: 'resume-1', userId: 'someone-else', status: 'PARSED', parsedData: { name: 'X' } });
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    expect(reserveQuota).not.toHaveBeenCalled();
  });
  it('rejects a JD interview whose analysis was run against a different resume (400 JD_RESUME_MISMATCH)', async () => {
    getUserById.mockResolvedValue({
      voiceId: 'Ruth',
      latestJdAnalysis: { jdSummary: 'Build APIs', roleTitle: 'SWE', matchScore: 72, resumeId: 'resume-OLD' }
    });
    const event = {
      body: JSON.stringify({ moduleType: 'JD', resumeId: 'resume-1',analysisId:'a' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('JD_RESUME_MISMATCH');
    expect(reserveQuota).not.toHaveBeenCalled();
  });

  it('rejects a JD interview with no prior job-match analysis (400)', async () => {
    getUserById.mockResolvedValue({ voiceId: 'Ruth' }); // no latestJdAnalysis
    const event = {
      body: JSON.stringify({ moduleType: 'JD', resumeId: 'resume-1',analysisId:'a' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('No job match analysis found. Analyze a job posting first.');
    expect(reserveQuota).not.toHaveBeenCalled();
  });
  it('accepts a JD interview when the analysis is bound to the selected resume', async () => {
    getUserById.mockResolvedValue({
      voiceId: 'Ruth',
      latestJdAnalysis: { jdSummary: 'Build APIs', roleTitle: 'SWE', matchScore: 72, resumeId: 'resume-1',analysisId:'a',jdDigest:'jd',resumeRevision:require('../../src/lib/contextIdentity').resumeRevision({parsedData:{name:'Test',skills:['node']}}) }
    });
    const event = {
      body: JSON.stringify({ moduleType: 'JD', resumeId: 'resume-1',analysisId:'a' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const itemData = createSession.mock.calls[0][3];
    expect(itemData.jdSummary).toBe('Build APIs');
    expect(itemData.jdRoleTitle).toBe('SWE');
  });

  it('accepts stable-version JD analysis without the newer identity fields', async () => {
    getUserById.mockResolvedValue({
      voiceId: 'Ruth',
      latestJdAnalysis: { jdSummary: 'Legacy', roleTitle: 'SWE', matchScore: 60 } // no resumeId
    });
    const event = {
      body: JSON.stringify({ moduleType: 'JD', resumeId: 'resume-1',analysisId:'a' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0][3].jdSummary).toBe('Legacy');
  });

  it('snapshots candidate name/role from canonical displayName/profession, not legacy keys', async () => {
    getUserById.mockResolvedValue({ voiceId: 'Ruth', displayName: 'Alice Doe', profession: 'Backend Engineer' });
    const event = {
      body: JSON.stringify({ moduleType: 'RESUME', resumeId: 'resume-1' }),
      requestContext: { authorizer: {emailVerified: true,  uid: 'user123' } }
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    const itemData = createSession.mock.calls[0][3];
    expect(itemData.userName).toBe('Alice Doe');
    expect(itemData.userCurrentRole).toBe('Backend Engineer');
  });
});
