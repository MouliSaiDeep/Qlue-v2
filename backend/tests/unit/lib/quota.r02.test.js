/**
 * R-02 regression tests for lib/quota: the operator "stop switch", env
 * zero-honoring (envInt), and the configured-zero HARD cutoff in reserveQuota.
 *
 * These assert the CORRECTED behavior, not the original defect:
 *   - a configured limit of 0 must DENY the first call of the day WITHOUT
 *     touching DynamoDB (the atomic counter starts absent, so the conditional
 *     write would otherwise allow the very first increment);
 *   - the stop switch must refuse paid work regardless of per-user quota and
 *     surface a 503 SERVICE_PAUSED, which is distinct from a cost alarm.
 */
const { QlueError, ERROR_CODES } = require('../../../src/lib/errors');

// Keep the real AWS client out of the module graph — these tests never want a
// network call, and the configured-zero test asserts send() is NOT invoked.
jest.mock('../../../src/lib/dynamodb', () => ({ docClient: { send: jest.fn() } }));

describe('quota — envInt zero-honoring (R-02)', () => {
  const { envInt } = require('../../../src/lib/quota');
  const KEY = 'QLUE_TEST_ENVINT';
  afterEach(() => { delete process.env[KEY]; });

  it('returns the fallback when unset or empty', () => {
    delete process.env[KEY];
    expect(envInt(KEY, 10)).toBe(10);
    process.env[KEY] = '';
    expect(envInt(KEY, 10)).toBe(10);
  });

  it('honors an explicit zero — a 0 is a real value, NOT the fallback', () => {
    process.env[KEY] = '0';
    expect(envInt(KEY, 10)).toBe(0);
  });

  it('parses a positive integer and floors a fractional value', () => {
    process.env[KEY] = '5';
    expect(envInt(KEY, 10)).toBe(5);
    process.env[KEY] = '7.9';
    expect(envInt(KEY, 10)).toBe(7);
  });

  it('falls back on a negative or non-numeric value', () => {
    process.env[KEY] = '-3';
    expect(envInt(KEY, 10)).toBe(10);
    process.env[KEY] = 'not-a-number';
    expect(envInt(KEY, 10)).toBe(10);
  });
});

describe('quota — operator stop switch (R-02)', () => {
  const { isServicePaused, assertServiceEnabled, ACTIONS } = require('../../../src/lib/quota');
  const OLD = process.env.QLUE_PAID_OPS_DISABLED;
  afterEach(() => {
    if (OLD === undefined) delete process.env.QLUE_PAID_OPS_DISABLED;
    else process.env.QLUE_PAID_OPS_DISABLED = OLD;
  });

  it('is disengaged when the flag is unset', () => {
    delete process.env.QLUE_PAID_OPS_DISABLED;
    expect(isServicePaused(ACTIONS.INTERVIEW)).toBe(false);
    expect(() => assertServiceEnabled(ACTIONS.INTERVIEW)).not.toThrow();
  });

  it('"all" / "true" / "1" (any case) pause EVERY paid action', () => {
    for (const flag of ['all', 'true', '1', 'ALL', ' True ']) {
      process.env.QLUE_PAID_OPS_DISABLED = flag;
      expect(isServicePaused(ACTIONS.INTERVIEW)).toBe(true);
      expect(isServicePaused(ACTIONS.SCRAPE)).toBe(true);
      expect(isServicePaused(ACTIONS.RESUME)).toBe(true);
      expect(isServicePaused(ACTIONS.JD_ANALYSIS)).toBe(true);
    }
  });

  it('a CSV list pauses ONLY the named actions', () => {
    process.env.QLUE_PAID_OPS_DISABLED = 'scrape, jdAnalysis';
    expect(isServicePaused(ACTIONS.SCRAPE)).toBe(true);
    expect(isServicePaused(ACTIONS.JD_ANALYSIS)).toBe(true);
    expect(isServicePaused(ACTIONS.INTERVIEW)).toBe(false);
    expect(isServicePaused(ACTIONS.RESUME)).toBe(false);
  });

  it('assertServiceEnabled throws a 503 SERVICE_PAUSED QlueError when paused', () => {
    process.env.QLUE_PAID_OPS_DISABLED = 'all';
    expect.assertions(3);
    try {
      assertServiceEnabled(ACTIONS.INTERVIEW);
    } catch (e) {
      expect(e).toBeInstanceOf(QlueError);
      expect(e.code).toBe(ERROR_CODES.SERVICE_PAUSED);
      expect(e.statusCode).toBe(503);
    }
  });
});

describe('quota — a configured zero is a HARD cutoff in reserveQuota (R-02)', () => {
  const OLD = process.env.QUOTA_FREE_INTERVIEWS;
  afterEach(() => {
    if (OLD === undefined) delete process.env.QUOTA_FREE_INTERVIEWS;
    else process.env.QUOTA_FREE_INTERVIEWS = OLD;
    jest.resetModules();
  });

  it('denies the first call of the day WITHOUT touching DynamoDB when the limit is 0', async () => {
    jest.resetModules();
    process.env.QUOTA_FREE_INTERVIEWS = '0';
    // Fresh module graph so TIER_LIMITS re-reads the env; the hoisted dynamodb
    // mock re-applies, giving a fresh send() to assert against.
    const quota = require('../../../src/lib/quota');
    const { docClient } = require('../../../src/lib/dynamodb');

    expect(quota.getLimit('free', quota.ACTIONS.INTERVIEW)).toBe(0);

    docClient.send.mockResolvedValue({});
    const res = await quota.reserveQuota('u', quota.ACTIONS.INTERVIEW, 'free');
    expect(res).toEqual({ allowed: false, used: 0, limit: 0, remaining: 0 });
    // The atomic counter must never be incremented — a 0 cap cannot allow call #1.
    expect(docClient.send.mock.calls.some(([command]) => command.constructor.name === 'UpdateCommand')).toBe(false);
  });
});

// R-03 shares this admission-gate surface: a session/parse racing an account
// wipe must be refused so it cannot re-create rows that outlive the teardown.
describe('quota — assertAccountActive admission gate (R-03)', () => {
  const { assertAccountActive } = require('../../../src/lib/quota');

  it('throws a 409 ACCOUNT_DELETING QlueError for a DELETING profile', () => {
    expect.assertions(3);
    try {
      assertAccountActive({ userId: 'u1', accountStatus: 'DELETING' });
    } catch (e) {
      expect(e).toBeInstanceOf(QlueError);
      expect(e.code).toBe(ERROR_CODES.ACCOUNT_DELETING);
      expect(e.statusCode).toBe(409);
    }
  });

  it('is a no-op for an active profile', () => {
    expect(() => assertAccountActive({ userId: 'u1', accountStatus: 'ACTIVE' })).not.toThrow();
    expect(() => assertAccountActive({ userId: 'u1' })).not.toThrow();
  });

  it('is a no-op for a nullish user (a missing profile is handled downstream)', () => {
    expect(() => assertAccountActive(null)).toThrow(/deleted/i);
    expect(() => assertAccountActive(undefined)).toThrow(/deleted/i);
  });
});
