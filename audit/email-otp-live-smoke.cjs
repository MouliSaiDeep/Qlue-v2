// Verify the deployed API with a unique synthetic account and AWS mailbox.
// Never logs passwords, ID tokens, OTPs, client secrets or service credentials.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const dir = path.resolve(__dirname, '../tmp/deploy-otp-2026-10-18');
const label = 'qlue-deploy-' + crypto.randomBytes(8).toString('hex');
const email = `success+${label}@simulator.amazonses.com`;
const password = 'Aa1!' + crypto.randomBytes(24).toString('base64url');
let uid, auth, stage = 'configuration';
const checks = [];
async function request(route, body, token, method = 'POST') {
  const response = await fetch('https://79440l9vo3.execute-api.us-east-1.amazonaws.com/prod' + route, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = {}; }
  return { status: response.status, data };
}
async function main() {
  const { stdout } = await execFile('C:/Program Files/Amazon/AWSCLIV2/aws.exe', ['cloudformation', 'list-stack-resources', '--stack-name', 'qlue-dev', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], { timeout: 30000 });
  const rs = JSON.parse(stdout).StackResourceSummaries;
  const resource = id => { const r = rs.find(r => r.LogicalResourceId === id); if (!r) throw Error('Missing ' + id); return r.PhysicalResourceId; };
  Object.assign(process.env, { AWS_REGION: 'us-east-1', USERS_TABLE: resource('UsersTable'), EMAIL_OTP_TABLE: resource('EmailOtpTable'),
    EMAIL_OTP_POOL_ID: resource('EmailOtpPool'), EMAIL_OTP_CLIENT_ID: resource('EmailOtpClient') });
  auth = await require('../backend/src/lib/firebase').getAuth();
  stage = 'unauthenticated-code';
  assert.equal((await request('/auth/send-otp', {})).status, 401); checks.push('OTP endpoint rejects missing Firebase identity');
  stage = 'register';
  const registered = await request('/auth/register', { email, password, displayName: 'Synthetic deployment check' });
  assert.equal(registered.status, 201); assert.equal(registered.data.verificationRequired, true);
  uid = registered.data.userId; assert(uid); checks.push('Registration requires verification');
  stage = 'unverified-login';
  const login = await request('/auth/login', { email, password });
  assert.equal(login.status, 403); assert.equal(login.data.error, 'EMAIL_NOT_VERIFIED'); checks.push('Unverified password login stays blocked');
  stage = 'firebase-session';
  const apiKey = await require('../backend/src/lib/secrets').getFirebaseApiKey();
  const session = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(20000)
  });
  assert.equal(session.status, 200); const { idToken } = await session.json(); assert(idToken);
  stage = 'protected-api';
  assert.equal((await request('/auth/profile', undefined, idToken, 'GET')).status, 403); checks.push('Protected API denies unverified Firebase token');
  stage = 'send';
  const sent = await request('/auth/send-otp', {}, idToken);
  assert.equal(sent.status, 200); assert.match(sent.data.challengeId, /^[a-f0-9]{32}$/);
  assert(sent.data.expiresAt > Date.now()); checks.push('Live API and Cognito accept managed-sender email to AWS mailbox simulator');
  stage = 'duplicate-send';
  const again = await request('/auth/send-otp', {}, idToken);
  assert.equal(again.status, 200); assert.equal(again.data.challengeId, sent.data.challengeId); assert.equal(again.data.alreadySent, true);
  checks.push('Immediate repeated send reuses challenge');
  stage = 'incorrect-code';
  const wrong = await request('/auth/verify-otp', { challengeId: sent.data.challengeId, code: '000000' }, idToken);
  assert.equal(wrong.status, 400); assert.equal(wrong.data.code, 'OTP_INVALID_OR_EXPIRED');
  assert.equal((await auth.getUser(uid)).emailVerified, false); checks.push('Incorrect code rejected without verifying Firebase account');
}
async function cleanup() {
  if (!auth) return;
  if (!uid) { try { uid = (await auth.getUserByEmail(email)).uid; } catch (e) { if (e.code !== 'auth/user-not-found') throw e; } }
  if (!uid) return;
  const { DynamoDBClient } = require('../backend/node_modules/@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, DeleteCommand } = require('../backend/node_modules/@aws-sdk/lib-dynamodb');
  await require('../backend/src/lib/emailOtpDelivery').remove(uid);
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1', maxAttempts: 2 }));
  await ddb.send(new DeleteCommand({ TableName: process.env.EMAIL_OTP_TABLE, Key: { id: `USER#${uid}` } }));
  await ddb.send(new DeleteCommand({ TableName: process.env.USERS_TABLE, Key: { userId: uid } }));
  // Only counters belonging to this explicitly created synthetic UID.
  const hour = Math.floor(Date.now() / 3600000);
  for (const bucket of [hour - 1, hour]) await ddb.send(new DeleteCommand({ TableName: process.env.EMAIL_OTP_TABLE, Key: { id: `VERIFY#${uid}#${bucket}` } }));
  await auth.deleteUser(uid); ddb.destroy();
  checks.push('Synthetic Firebase, Cognito and per-user DynamoDB records removed');
}
(async () => {
  let error;
  try { await main(); } catch (e) { error = e; console.error(JSON.stringify({ stage, error: e.name, message: e.message })); }
  try { await cleanup(); } catch (e) { error = e; console.error('Synthetic cleanup requires attention:', e.name); }
  const result = { testedAt: new Date().toISOString(), passed: !error, checks, recipient: 'AWS mailbox simulator', realInboxReceiptTested: false, receivedCorrectCodeTested: false };
  fs.writeFileSync(path.join(dir, 'live-otp-smoke.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result)); if (error) process.exitCode = 1;
})().catch(e => { console.error(e.name); process.exitCode = 1; });
