// Read only. Never prints credentials, OAuth tokens, reset links or email bodies.
const fs = require('node:fs'), path = require('node:path');
const { GoogleAuth } = require('../backend/node_modules/google-auth-library');
(async () => {
  const credentials = await require('../backend/src/lib/secrets').getFirebaseServiceAccount();
  const account = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
  const auth = new GoogleAuth({ credentials: account, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { data } = await client.request({ url: `https://identitytoolkit.googleapis.com/admin/v2/projects/${account.project_id}/config`, timeout: 15000 });
  const email = data.notification?.sendEmail || {};
  const template = email.resetPasswordTemplate || {};
  const result = { project: account.project_id, emailEnumerationProtection: data.emailPrivacyConfig?.enableImprovedEmailPrivacy === true,
    passwordSignInEnabled: data.signIn?.email?.enabled === true, emailMethod: email.method,
    resetSender: template.senderEmail, resetActionUrl: template.customizedActionUrl || null,
    passwordPolicy: data.passwordPolicyConfig, authorizedDomains: data.authorizedDomains };
  fs.mkdirSync(path.resolve(__dirname, '../tmp/password-reset'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../tmp/password-reset/firebase-config.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(JSON.stringify({ name: error.name, status: error.response?.status, code: error.code })); process.exitCode = 1; });
