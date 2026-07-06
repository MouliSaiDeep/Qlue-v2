/**
 * Runtime configuration loader backed by AWS SSM Parameter Store (with caching).
 *
 * COST-FIX: Migrated from AWS Secrets Manager, which bills $0.40 per secret
 * per month just for existing (4 secrets = ~$1.60/mo + tax while fully idle).
 * SSM Parameter Store standard-tier parameters are free, including
 * SecureString values encrypted with the AWS-managed key.
 *
 * The exported function names are unchanged, so no caller needed to change.
 * Parameter names mirror the old secret names under the /qlue/ hierarchy,
 * e.g. secret "qlue/bedrock-config" -> parameter "/qlue/bedrock-config".
 */
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

// In-memory cache to reuse values across invocations within a warm container.
const paramCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get and cache a parameter. Values stored as JSON strings are parsed;
 * anything else is returned as a plain string. SecureString parameters are
 * transparently decrypted (WithDecryption).
 */
async function getSecret(parameterName) {
  // Accept both legacy secret-style names ("qlue/x") and SSM paths ("/qlue/x").
  const name = parameterName.startsWith('/') ? parameterName : `/${parameterName}`;

  const now = Date.now();
  const cached = paramCache.get(name);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const response = await client.send(new GetParameterCommand({
      Name: name,
      WithDecryption: true
    }));

    const raw = response.Parameter?.Value;
    let value;
    try {
      value = JSON.parse(raw);
    } catch (e) {
      value = raw; // Not JSON, treat as plain string
    }

    paramCache.set(name, { value, timestamp: now });
    return value;
  } catch (error) {
    console.error(`Failed to retrieve parameter ${name}`, error);
    // Let exceptions like ParameterNotFound bubble up, matching the previous
    // Secrets Manager behaviour.
    throw error;
  }
}

async function getFirebaseServiceAccount() {
  if (process.env.MOCK_FIREBASE_SERVICE_ACCOUNT) {
    return process.env.MOCK_FIREBASE_SERVICE_ACCOUNT;
  }
  return getSecret('/qlue/firebase-service-account');
}

async function getBedrockConfig() {
  if (process.env.MOCK_BEDROCK_CONFIG) {
    return process.env.MOCK_BEDROCK_CONFIG;
  }
  return getSecret('/qlue/bedrock-config');
}

async function getScraperApiKey() {
  const envKey = process.env.SCRAPER_API_KEY || process.env.MOCK_SCRAPER_API_KEY;
  if (envKey) {
    return envKey;
  }
  return getSecret('/qlue/scraper-api-key');
}

async function getFCMServerKey() {
  if (process.env.MOCK_FCM_SERVER_KEY) {
    return process.env.MOCK_FCM_SERVER_KEY;
  }
  return getSecret('/qlue/fcm-server-key');
}

module.exports = {
  getSecret,
  getFirebaseServiceAccount,
  getBedrockConfig,
  getScraperApiKey,
  getFCMServerKey
};
