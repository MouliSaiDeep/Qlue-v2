const otp = require('../../lib/emailOtp');
const deadline = require('../../lib/deadline');

function endpoint(action) {
  return (event, context) => deadline.withDeadline(context, async () => {
    try {
      const person = await otp.identity(event);
      const body = JSON.parse(event.body || '{}');
      const data = action === 'send'
        ? await otp.issue(person, event.requestContext?.identity?.sourceIp || event.requestContext?.http?.sourceIp)
        : await otp.verify(person, body.challengeId, body.code);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) };
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : error.code === 'ACCOUNT_DELETING' ? 403 : error.statusCode || 503;
      require('../../lib/logger').safeConsole.warn('Email verification request failed', { name: error.name, code: error.code });
      return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '60' } : {}) },
        body: JSON.stringify({ code: error.code || 'OTP_UNAVAILABLE', error: error.statusCode ? error.message : 'Email verification is temporarily unavailable. Please try again.' }) };
    }
  }, { maxMs: 20000 });
}
exports.send = endpoint('send');
exports.verify = endpoint('verify');
