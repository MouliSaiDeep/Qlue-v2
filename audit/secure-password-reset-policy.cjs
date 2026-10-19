// Narrow, reviewable provider policy update. No users, emails or secrets logged.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { GoogleAuth } = require('../backend/node_modules/google-auth-library');
(async () => {
  const raw = await require('../backend/src/lib/secrets').getFirebaseServiceAccount();
  const credentials = typeof raw === 'string' ? JSON.parse(raw) : raw;
  assert.equal(credentials.project_id, 'qlue-backend-2c0c7');
  const client = await new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${credentials.project_id}/config`;
  const { data: before } = await client.request({ url, timeout: 15000 });
  assert.equal(before.emailPrivacyConfig?.enableImprovedEmailPrivacy, true);
  assert(!before.passwordPolicyConfig, 'Existing provider password policy changed; inspect before replacing it');
  const policy = { passwordPolicyEnforcementState: 'ENFORCE', forceUpgradeOnSignin: false,
    passwordPolicyVersions: [{ customStrengthOptions: { minPasswordLength: 8, containsLowercaseCharacter: true,
      containsUppercaseCharacter: true, containsNumericCharacter: true, containsNonAlphanumericCharacter: true } }] };
  const dir = path.resolve(__dirname, '../tmp/password-reset'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'password-policy-change.json'), JSON.stringify({ previousPolicy: before.passwordPolicyConfig || null, requestedPolicy: policy }, null, 2));
  if (process.argv[2] !== '--apply') { console.log(JSON.stringify({ project: credentials.project_id, requestedPolicy: policy, changesApplied: false })); return; }
  await client.request({ url, method: 'PATCH', params: { updateMask: 'passwordPolicyConfig' }, data: { passwordPolicyConfig: policy }, timeout: 15000 });
  const { data: after } = await client.request({ url, timeout: 15000 });
  assert.equal(after.passwordPolicyConfig.passwordPolicyEnforcementState, 'ENFORCE');
  assert.notEqual(after.passwordPolicyConfig.forceUpgradeOnSignin, true);
  assert.deepEqual(after.emailPrivacyConfig, before.emailPrivacyConfig);
  assert.deepEqual(after.signIn, before.signIn); assert.deepEqual(after.notification, before.notification);
  const result = { project: credentials.project_id, passwordPolicy: after.passwordPolicyConfig, emailEnumerationProtection: true,
    forcedExistingPasswordUpgrade: false, otherAuthSettingsPreserved: true };
  fs.writeFileSync(path.join(dir, 'password-policy-applied.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
})().catch(e => { console.error(JSON.stringify({ name: e.name, status: e.response?.status, code: e.code, message: e.response ? undefined : e.message })); process.exitCode = 1; });
