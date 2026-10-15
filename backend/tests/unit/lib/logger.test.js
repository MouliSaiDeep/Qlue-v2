/**
 * R-08 log-hygiene regressions for lib/logger. The redactor is the backstop that
 * keeps secrets and signed-URL query strings out of CloudWatch even when a
 * handler logs something it shouldn't. These assert the corrected behavior,
 * including the fix that routes an Error's `message` through URL masking (it is
 * attacker/third-party-influenced free text, e.g. a failed fetch to a signed S3
 * URL).
 */
const { redact } = require('../../../src/lib/logger');

const SIGNED =
  'https://bucket.s3.amazonaws.com/resumes/u1/file.pdf' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeefdeadbeef&X-Amz-Credential=AKIAEXAMPLE';

describe('logger.redact — R-08 secret/URL masking', () => {
  it('drops the signed query string from a plain string value, keeping the path', () => {
    const out = redact(SIGNED);
    expect(out).toContain('/resumes/u1/file.pdf');
    expect(out).toContain('[REDACTED_QUERY]');
    expect(out).not.toContain('X-Amz-Signature');
    expect(out).not.toContain('deadbeefdeadbeef');
    expect(out).not.toContain('AKIAEXAMPLE');
  });

  it('masks a signed URL embedded in an Error message (the fixed branch)', () => {
    const err = new Error(`Download failed for ${SIGNED}`);
    err.code = 'ETIMEDOUT';
    const out = redact(err);

    expect(out.name).toBe('Error');
    expect(out.code).toBe('ETIMEDOUT');
    // The message is kept for debuggability but the credential-bearing query is gone.
    expect(out.message).toBe('[REDACTED_ERROR_MESSAGE]');
    expect(out.message).not.toContain('Download failed for');
    expect(out.message).not.toContain('X-Amz-Signature');
    expect(out.message).not.toContain('deadbeefdeadbeef');
  });

  it('preserves a non-signed Error message untouched', () => {
    const out = redact(new Error('plain failure, no url'));
    expect(out.message).toBe('[REDACTED_ERROR_MESSAGE]');
  });

  it('redacts values under sensitive key names', () => {
    const out = redact({ authorization: 'Bearer abc.def.ghi', idToken: 'xyz', keep: 'ok' });
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.idToken).toBe('[REDACTED]');
    expect(out.keep).toBe('ok');
  });

  it('masks signed URLs nested inside objects and arrays', () => {
    const out = redact({ urls: [SIGNED], nested: { link: SIGNED } });
    expect(out.urls[0]).toContain('[REDACTED_QUERY]');
    expect(out.urls[0]).not.toContain('X-Amz-Signature');
    expect(out.nested.link).toContain('[REDACTED_QUERY]');
  });
});
