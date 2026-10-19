// Real Firebase reset protocol against a uniquely owned synthetic account.
// Secrets, passwords, tokens and reset links remain in memory and are never logged.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const dir = path.resolve(__dirname, '../tmp/password-reset');
const uid = 'password-reset-smoke-' + crypto.randomUUID();
const email = `success+${uid}@simulator.amazonses.com`;
const oldPassword = 'Aa1!' + crypto.randomBytes(24).toString('hex');
const newPassword = 'Bb2!' + crypto.randomBytes(24).toString('hex');
let auth, created = false, stage = 'configuration';
const checks = [];
async function main() {
  const key = await require('../backend/src/lib/secrets').getFirebaseApiKey();
  auth = await require('../backend/src/lib/firebase').getAuth();
  const api = async (method, data) => {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(20000)
    });
    return { status: response.status, body: await response.json() };
  };
  stage = 'create-synthetic';
  await auth.createUser({ uid, email, password: oldPassword, emailVerified: true }); created = true;
  const oldLogin = await api('signInWithPassword', { email, password: oldPassword, returnSecureToken: true });
  assert.equal(oldLogin.status, 200); assert.equal(oldLogin.body.localId, uid);
  stage = 'managed-reset-request';
  const sent = await api('sendOobCode', { requestType: 'PASSWORD_RESET', email });
  assert.equal(sent.status, 200); checks.push('Firebase accepts managed reset email request to AWS mailbox simulator');
  const unknown = await api('sendOobCode', { requestType: 'PASSWORD_RESET', email: `absent-${crypto.randomUUID()}@example.invalid` });
  assert.equal(unknown.status, 200);
  assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(sent.body).sort());
  checks.push('Unknown-account reset receives neutral success from provider');
  stage = 'generate-owned-reset-action';
  const link = new URL(await auth.generatePasswordResetLink(email));
  assert.equal(link.protocol, 'https:'); assert.equal(link.hostname, 'qlue-backend-2c0c7.firebaseapp.com');
  assert.equal(link.pathname, '/__/auth/action'); assert.equal(link.searchParams.get('mode'), 'resetPassword');
  const code = link.searchParams.get('oobCode'); assert(code);
  const landing = await fetch(link, { signal: AbortSignal.timeout(20000) });
  assert.equal(landing.status, 200); checks.push('Configured Firebase hosted reset action page returns HTTP 200');
  stage = 'invalid-code';
  assert.equal((await api('resetPassword', { oobCode: 'invalid-reset-test-code', newPassword })).status, 400);
  checks.push('Invalid reset token rejected');
  stage = 'weak-password';
  const weak = await api('resetPassword', { oobCode: code, newPassword: 'password123' });
  assert.equal(weak.status, 400); assert.match(weak.body.error?.message || '', /PASSWORD|WEAK/);
  checks.push('Provider rejects password that misses required character types');
  stage = 'confirm-reset';
  assert.equal((await api('resetPassword', { oobCode: code, newPassword })).status, 200);
  checks.push('Valid single-use token resets password');
  stage = 'old-password';
  assert.equal((await api('signInWithPassword', { email, password: oldPassword, returnSecureToken: true })).status, 400);
  checks.push('Old password no longer authenticates');
  stage = 'new-password';
  const login = await api('signInWithPassword', { email, password: newPassword, returnSecureToken: true });
  assert.equal(login.status, 200); assert.equal(login.body.localId, uid);
  checks.push('New password authenticates the same account');
  stage = 'replay';
  assert.equal((await api('resetPassword', { oobCode: code, newPassword: oldPassword })).status, 400);
  checks.push('Consumed reset token cannot be reused');
  stage = 'revoke-old-session';
  await assert.rejects(auth.verifyIdToken(oldLogin.body.idToken, true), e => ['auth/id-token-revoked', 'auth/user-token-expired'].includes(e.code));
  checks.push('Existing Firebase session is revoked after reset');
}
(async () => {
  let error;
  try { await main(); } catch (e) { error = e; console.error(JSON.stringify({ stage, error: e.name, code: e.code, assertion: e instanceof assert.AssertionError ? e.message : undefined })); }
  if (created) {
    try { assert(uid.startsWith('password-reset-smoke-')); await auth.deleteUser(uid); checks.push('Synthetic Firebase account removed'); }
    catch (e) { error = e; console.error('Synthetic cleanup requires attention', e.code || e.name); }
  }
  const result = { testedAt: new Date().toISOString(), passed: !error, checks, recipient: 'AWS mailbox simulator', actualInboxReceiptTested: false,
    resetActionSource: 'Admin-generated action for synthetic account; email action contents not retrieved', syntheticAccountRemoved: created && checks.includes('Synthetic Firebase account removed') };
  fs.writeFileSync(path.join(dir, 'live-smoke.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  if (error) process.exitCode = 1;
})().catch(e => { console.error(e.name); process.exitCode = 1; });
