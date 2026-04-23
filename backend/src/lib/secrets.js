/**
 * AWS Secrets Manager utility wrapper with caching.
 */
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Use Lambda execution environment variables to map regions securely
const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

// In-memory cache for secrets to handle scale out during container lifespan
const secretsCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get and optionally cache a secret.
 */
async function getSecret(secretName) {
  const now = Date.now();
  const cached = secretsCache.get(secretName);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);
    
    let secretValue;
    if (response.SecretString) {
      try {
        secretValue = JSON.parse(response.SecretString);
      } catch (e) {
        secretValue = response.SecretString; // Unparseable as JSON, treat as plain string
      }
    } else {
      // Decode SecretBinary if present
      secretValue = Buffer.from(response.SecretBinary, 'base64').toString('ascii');
    }

    secretsCache.set(secretName, {
      value: secretValue,
      timestamp: now
    });

    return secretValue;
  } catch (error) {
    console.error(`Failed to retrieve secret ${secretName}`, error);
    // Let exceptions like ResourceNotFoundException bubble up as requested
    throw error;
  }
}

async function getFirebaseServiceAccount() {
  if (process.env.MOCK_FIREBASE_SERVICE_ACCOUNT) {
    return process.env.MOCK_FIREBASE_SERVICE_ACCOUNT;
  }
  return getSecret('qlue/firebase-service-account');
}

async function getBedrockConfig() {
  if (process.env.MOCK_BEDROCK_CONFIG) {
    return process.env.MOCK_BEDROCK_CONFIG;
  }
  return getSecret('qlue/bedrock-config');
}

async function getScraperApiKey() {
  const envKey = process.env.SCRAPER_API_KEY || process.env.MOCK_SCRAPER_API_KEY;
  if (envKey) {
    return envKey;
  }
  return getSecret('qlue/scraper-api-key');
}

async function getFCMServerKey() {
  if (process.env.MOCK_FCM_SERVER_KEY) {
    return process.env.MOCK_FCM_SERVER_KEY;
  }
  return getSecret('qlue/fcm-server-key');
}

module.exports = {
  getSecret,
  getFirebaseServiceAccount,
  getBedrockConfig,
  getScraperApiKey,
  getFCMServerKey
};
