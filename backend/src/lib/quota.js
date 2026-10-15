const diagnostics=require('./logger').safeConsole;
/**
 * Per-user daily usage quotas for paid operations (audit finding 3).
 *
 * The free public tier allows a fixed number of mock interviews per day. Limits
 * are TIER-DERIVED, not hardcoded at the call site, so future subscription tiers
 * only need a new entry in TIER_LIMITS — no handler changes. Reservation is an
 * atomic conditional counter in the UsageTable, so concurrent /interview/init
 * calls cannot exceed the cap, and a failed init refunds its reservation.
 *
 * Row shape (UsageTable): PK userId (S), SK date (S, UTC YYYY-MM-DD),
 * one numeric attribute per action (e.g. `interview`), and `expiresAt` (epoch
 * seconds) as a TTL backstop so old rows self-delete.
 */
const { docClient } = require('./dynamodb');
const { UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { QlueError, ERROR_CODES } = require('./errors');

const USAGE_TABLE = process.env.USAGE_TABLE || 'qlue-usage';
const DEFAULT_TIER = 'free';
const TTL_DAYS = 2;

/**
 * Parse a non-negative integer from the environment, honoring an explicit zero.
 * `Number(x) || fallback` is WRONG for limits: a configured `0` is falsy, so it
 * silently became the fallback — there was no way to set an intentional hard
 * cutoff of zero (R-02). This returns the fallback ONLY when the value is unset
 * or not a finite number >= 0, so `QUOTA_FREE_INTERVIEWS=0` really means zero.
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// Actions that consume quota. Keep attribute names stable — they are the
// DynamoDB attribute keys. Every PAID surface has its own per-day action so one
// expensive feature cannot be hammered to run unbounded model/OCR/scrape work
// even after another feature's cap is spent (R-02).
const ACTIONS = {
  INTERVIEW: 'interview',   // /interview/init — Bedrock + Polly per turn
  JD_ANALYSIS: 'jdAnalysis', // /jd/analyze — scrape/OCR + Bedrock
  SCRAPE: 'scrape',          // /scraper/fetch, /website/validate — scrape.do + Bedrock
  FEEDBACK: 'feedback',
  SUPPORT: 'support',
  RESUME: 'resumeParse'      // /resume/process — Textract + Bedrock
};

// Tier configuration. Each paid action's value is the max per UTC day; a value
// of null means unlimited. `premiumVoice` gates server-side voice eligibility
// (finding 3) — clients can no longer just ask for it. Every cap is
// env-overridable for ops tuning; a configured ZERO is a real per-action cutoff
// (see envInt + the limit<=0 guard in reserveQuota).
const TIER_LIMITS = {
  free: {
    analysisAdmission: envInt('QUOTA_FREE_ANALYSIS_ADMISSIONS', 30),
    uploadAdmission: envInt('QUOTA_FREE_UPLOAD_ADMISSIONS', 10),
    feedback: envInt('QUOTA_FREE_FEEDBACK', 5),
    support: envInt('QUOTA_FREE_SUPPORT', 5),
    interview: envInt('QUOTA_FREE_INTERVIEWS', 10),
    // Generous defaults: these bound per-user cost without hurting normal use.
    jdAnalysis: envInt('QUOTA_FREE_JD_ANALYSIS', 30),
    scrape: envInt('QUOTA_FREE_SCRAPE', 60),
    resumeParse: envInt('QUOTA_FREE_RESUME_PARSE', 25),
    // Generative voices are deliberately enabled for the free tier (funded by
    // credits, bounded by the daily interview cap). Flip to false when paid
    // tiers land to reserve premium voices for subscribers.
    premiumVoice: true
  }
  // Example future tier:
  // pro: { interview: 100, jdAnalysis: null, scrape: null, resumeParse: null, premiumVoice: true }
};

/**
 * Global/per-action admission cutoff — the "stop switch" (R-02). Returns true
 * when paid work for `action` must be refused regardless of per-user quota.
 * Controlled by env so ops can halt spend WITHOUT a redeploy (SSM-backed env or
 * a config flip), unlike a CloudWatch cost alarm which only notifies:
 *   QLUE_PAID_OPS_DISABLED = "all" | "true" | "1"   → every paid action off
 *   QLUE_PAID_OPS_DISABLED = "scrape,jdAnalysis"     → only the listed actions off
 */
function isServicePaused(action) {
  const flag = (process.env.QLUE_PAID_OPS_DISABLED || '').trim().toLowerCase();
  if (!flag) return false;
  if (flag === 'all' || flag === 'true' || flag === '1') return true;
  return flag.split(',').map((s) => s.trim()).filter(Boolean).includes(String(action).toLowerCase());
}

/**
 * Throws SERVICE_PAUSED (503) when the stop switch is engaged for `action`.
 * Call this at the ADMISSION of every paid entry point, before any spend.
 */
function assertServiceEnabled(action) {
  if (isServicePaused(action)) {
    throw new QlueError(
      'This feature is temporarily unavailable. Please try again shortly.',
      ERROR_CODES.SERVICE_PAUSED, 503
    );
  }
}

/**
 * Throws ACCOUNT_DELETING (409) when the caller's account has been tombstoned
 * for deletion (R-03). Call this at the admission of paid/stateful entry points
 * — after loading the user row — so a request issued while account teardown is
 * in flight cannot start new paid work or write rows that would survive (or
 * race) the wipe. A nullish user (profile already gone) is treated as not
 * active-blocking here: the downstream path handles the missing profile.
 */
function assertAccountActive(user) {
  if (!user || ['DELETING','DELETED'].includes(user.accountStatus)) {
    throw new QlueError(
      'Your account is being deleted and can no longer be used.',
      ERROR_CODES.ACCOUNT_DELETING, 409
    );
  }
}

function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

function ttlEpoch(now = Date.now()) {
  return Math.floor(now / 1000) + TTL_DAYS * 24 * 60 * 60;
}

function getUserTier(user) {
  assertAccountActive(user);
  const tier = user?.tier || DEFAULT_TIER;
  return TIER_LIMITS[tier] ? tier : DEFAULT_TIER;
}

function getLimit(tier, action) {
  const cfg = TIER_LIMITS[tier] || TIER_LIMITS[DEFAULT_TIER];
  const limit = cfg[action];
  return limit === undefined ? null : limit;
}

function isPremiumVoiceAllowed(tier) {
  const cfg = TIER_LIMITS[tier] || TIER_LIMITS[DEFAULT_TIER];
  return !!cfg.premiumVoice;
}

/**
 * Atomically reserve one unit of `action` for today. Returns
 * { allowed, used, limit, remaining }. When the cap is reached the conditional
 * write fails and { allowed: false } is returned without incrementing.
 */
async function reserveQuota(userId, action, tier = DEFAULT_TIER) {
  await require('./deletionJob').assertNotDeleting(userId);
  await require('./paidWork').assertRuntimeEnabled(action);
  const limit = getLimit(tier, action);
  const date = utcDate();

  // A configured zero (or negative) is an intentional HARD cutoff for this
  // action — deny without touching the counter (R-02). The conditional write
  // below (`attribute_not_exists(#a) OR #a < 0`) would otherwise ALLOW the very
  // first call of the day, because the counter attribute starts absent.
  if (limit !== null && limit <= 0) {
    return { allowed: false, used: 0, limit, remaining: 0 };
  }

  const base = {
    TableName: USAGE_TABLE,
    Key: { userId, date },
    ExpressionAttributeNames: { '#a': action },
    ReturnValues: 'UPDATED_NEW'
  };

  // Unlimited tier: still count usage for visibility, but no gate.
  if (limit === null) {
    const res = await require('./dynamodb').fencedSend(new UpdateCommand({
      ...base,
      UpdateExpression: 'SET expiresAt = if_not_exists(expiresAt, :ttl) ADD #a :one',
      ExpressionAttributeValues: { ':one': 1, ':ttl': ttlEpoch() }
    }),userId);
    const used = res.Attributes?.[action] || 0;
    return { allowed: true, used, limit: null, remaining: null };
  }

  try {
    const res = await require('./dynamodb').fencedSend(new UpdateCommand({
      ...base,
      UpdateExpression: 'SET expiresAt = if_not_exists(expiresAt, :ttl) ADD #a :one',
      ConditionExpression: 'attribute_not_exists(#a) OR #a < :limit',
      ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':ttl': ttlEpoch() }
    }),userId);
    const used = res.Attributes?.[action] || 0;
    return { allowed: true, used, limit, remaining: Math.max(0, limit - used) };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return { allowed: false, used: limit, limit, remaining: 0 };
    }
    throw err;
  }
}

/**
 * Best-effort refund of a previously reserved unit (never drives below zero).
 * Failures are swallowed — a lost refund only costs the user one slot, which
 * the daily reset restores; throwing here would mask the original error.
 */
async function refundQuota(userId, action) {
  const date = utcDate();
  try {
    await require('./dynamodb').fencedSend(new UpdateCommand({
      TableName: USAGE_TABLE,
      Key: { userId, date },
      UpdateExpression: 'ADD #a :neg',
      ConditionExpression: '#a > :zero',
      ExpressionAttributeNames: { '#a': action },
      ExpressionAttributeValues: { ':neg': -1, ':zero': 0 }
    }),userId);
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      diagnostics.warn(`[quota] refund failed for ${action}:`, err.name);
    }
  }
}

/**
 * Read today's usage for display (GET /interview/usage). Never throws for a
 * missing row — an absent row means zero usage.
 */
async function getUsage(userId, tier = DEFAULT_TIER) {
  const date = utcDate();
  let item = {};
  try {
    const res = await require('./deadline').sendBounded(docClient,new GetCommand({ TableName: USAGE_TABLE, Key: { userId, date } }));
    item = res.Item || {};
  } catch (err) {
    diagnostics.warn('[quota] getUsage read failed:', err.name);
  }
  const limit = getLimit(tier, ACTIONS.INTERVIEW);
  const used = item[ACTIONS.INTERVIEW] || 0;
  return {
    tier,
    date,
    interviews: {
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used)
    }
  };
}

module.exports = {
  ACTIONS,
  TIER_LIMITS,
  DEFAULT_TIER,
  envInt,
  isServicePaused,
  assertServiceEnabled,
  assertAccountActive,
  getUserTier,
  getLimit,
  isPremiumVoiceAllowed,
  reserveQuota,
  refundQuota,
  getUsage
};
