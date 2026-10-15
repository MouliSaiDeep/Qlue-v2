/** Bounded PDF.js page-tree validation in a resource-limited worker. Signed
 * POST policies enforce storage admission size; all OCR reads pin S3 versions.
 * Legacy marker inspection helpers below are diagnostics, never validators. */
const { QlueError, ERROR_CODES } = require('./errors');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

// Shared upload limits (single source of truth for the URL handlers and the
// pre-OCR gates). Overridable by env so limits can be tuned without a redeploy.
const MAX_RESUME_PDF_BYTES = parseInt(process.env.MAX_RESUME_PDF_BYTES || String(10 * 1024 * 1024), 10);
const MAX_RESUME_PDF_PAGES = parseInt(process.env.MAX_RESUME_PDF_PAGES || '15', 10);
const MAX_JD_PDF_BYTES = parseInt(process.env.MAX_JD_PDF_BYTES || String(10 * 1024 * 1024), 10);
const MAX_JD_PDF_PAGES = parseInt(process.env.MAX_JD_PDF_PAGES || '15', 10);

const PDF_MAGIC = '%PDF-';
// %PDF- must appear near the start of a conforming file. Adobe's readers
// tolerate a little leading junk, so scan a short prefix rather than demanding
// it at byte 0.
const HEADER_SCAN_BYTES = 1024;

const mb = (bytes) => Math.floor(bytes / (1024 * 1024));

/** True when the buffer's leading bytes contain the %PDF- signature. */
function looksLikePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PDF_MAGIC.length) return false;
  return buffer.subarray(0, HEADER_SCAN_BYTES).toString('latin1').includes(PDF_MAGIC);
}

/**
 * Heuristic: a standard-encrypted PDF carries an /Encrypt entry in its trailer.
 * Rejecting these up front avoids paying for a Textract job that cannot succeed.
 */
function isEncryptedPdf(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  return buffer.includes(Buffer.from('/Encrypt'));
}

/**
 * Heuristic page count: count page objects (/Type /Page, but not /Pages). Good
 * enough to cap absurdly long documents before OCR; not a spec-perfect parse.
 */
function countPdfPages(buffer) {
  if (!Buffer.isBuffer(buffer)) return 0;
  const matches = buffer.toString('latin1').match(/\/Type\s*\/Page(?![sz])/g);
  return matches ? matches.length : 0;
}

/**
 * R-04: gather structural evidence that this is a REAL PDF document with at
 * least one page, so a `%PDF-` header followed by junk (no page tree, no
 * trailer) is rejected instead of admitted with pages:0.
 *
 * Regex page counting alone is unreliable for PDFs whose pages live in
 * compressed object streams (/ObjStm) — those legitimately count 0 explicit
 * `/Type /Page` objects. So "valid" means: explicit page objects, OR a page
 * tree `/Count`, OR compressed object streams — AND the file is terminated with
 * an %%EOF/startxref trailer. This does not replace a full parser (see
 * assertValidPdf notes); it closes the zero-page-junk admission.
 */
function pdfStructure(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : '';
  const explicitPages = countPdfPages(buffer);
  const countMatch = text.match(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/)
    || text.match(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/);
  const declaredCount = countMatch ? parseInt(countMatch[1], 10) : null;
  const hasObjStm = /\/Type\s*\/ObjStm\b/.test(text) || /\/ObjStm\b/.test(text);
  const hasTrailer = text.includes('%%EOF') || /\bstartxref\b/.test(text);
  // Best-effort effective page count for capping.
  const pages = explicitPages > 0
    ? explicitPages
    : (declaredCount != null ? declaredCount : 0);
  return { pages, explicitPages, declaredCount, hasObjStm, hasTrailer };
}

/**
 * Validate a client-declared byte size at presign time. The declared size is
 * only advisory (the real size is enforced post-upload, before OCR), but
 * rejecting obviously-bad values early avoids minting URLs for junk and turns a
 * NaN/negative/fractional size into a clean 400 instead of a later surprise.
 * Returns { ok: true, size } or { ok: false, code, message }.
 */
function validateDeclaredSize(fileSize, maxBytes) {
  const n = Number(fileSize);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, code: ERROR_CODES.INVALID_FILE_TYPE, message: 'Invalid file size.' };
  }
  if (maxBytes && n > maxBytes) {
    return { ok: false, code: ERROR_CODES.FILE_TOO_LARGE, message: `File is too large (max ${mb(maxBytes)} MB).` };
  }
  return { ok: true, size: n };
}

/**
 * Validate an in-memory buffer as a well-formed, unencrypted, reasonably sized
 * PDF. Throws a QlueError (with .code / .statusCode) on the first problem;
 * returns { pages } on success.
 */
async function assertValidPdf(buffer, { maxBytes = MAX_RESUME_PDF_BYTES, maxPages = MAX_RESUME_PDF_PAGES, timeoutMs = 5000 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new QlueError('The uploaded file is empty or unreadable.', ERROR_CODES.INVALID_FILE_TYPE, 400);
  }
  if (maxBytes && buffer.length > maxBytes) {
    throw new QlueError(`File is too large (max ${mb(maxBytes)} MB).`, ERROR_CODES.FILE_TOO_LARGE, 400);
  }
  if (!looksLikePdf(buffer)) {
    throw new QlueError('This file is not a valid PDF.', ERROR_CODES.INVALID_FILE_TYPE, 400);
  }
  if (isEncryptedPdf(buffer)) {
    throw new QlueError('This PDF is password-protected or encrypted. Please upload an unprotected PDF.', ERROR_CODES.INVALID_FILE_TYPE, 400);
  }
  // R-04: require positive evidence of a real, non-empty document. A bare
  // `%PDF-` header with no page tree and no trailer (the reproduced probe input)
  // is rejected here instead of being admitted with pages:0 and sent to paid OCR.
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'pdfValidationWorker.cjs'), {
      workerData: { bytes: buffer, maxPages },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const invalid = message => new QlueError(message, ERROR_CODES.INVALID_FILE_TYPE, 400);
    const timer = setTimeout(() => finish(invalid('PDF validation exceeded its resource deadline.')), timeoutMs);
    worker.on('message', result => {
      if (result.error === 'PAGE_LIMIT') finish(new QlueError(`This PDF has too many pages (max ${maxPages}).`, ERROR_CODES.FILE_TOO_LARGE, 400));
      else if (result.error) finish(invalid('This PDF is invalid, encrypted, or unreadable.'));
      else finish(null, { pages: result.pages });
    });
    worker.on('error', () => finish(invalid('PDF parser failed within its resource limits.')));
    worker.on('exit', () => { if (!settled) finish(invalid('PDF parser stopped before validating the document.')); });
  });
}

/**
 * Downloads an uploaded object and validates it before any paid OCR runs.
 * headObject enforces the REAL uploaded size (cheap, and short-circuits before
 * the download); the object bytes then gate magic/encryption/page-count. `s3` is
 * injected so this stays unit-testable and pdf.js keeps no hard S3 dependency.
 *
 * R-04 (TOCTOU): a presigned PUT is reusable within its expiry, so the object
 * behind a key can change between validation and OCR. This HEADs the object,
 * then pins the body read — and returns the pinned version so the caller pins
 * the Textract job to it too — guaranteeing the bytes we validated are exactly
 * the bytes OCR'd. `opts.versionId` lets a caller require a specific version
 * (e.g. the one claimed at upload admission); otherwise the current version the
 * HEAD resolves is used. Non-versioned storage is rejected. Throws a QlueError on any problem; returns
 * { pages, versionId } on success.
 */
async function assertValidS3Pdf(s3, bucket, key, { maxBytes, maxPages, versionId } = {}) {
  const meta = await s3.headObject(bucket, key, versionId);
  if (!meta) {
    throw new QlueError('The uploaded file could not be found.', ERROR_CODES.INVALID_FILE_TYPE, 400);
  }
  if (maxBytes && Number(meta.contentLength) > maxBytes) {
    throw new QlueError(`File is too large (max ${mb(maxBytes)} MB).`, ERROR_CODES.FILE_TOO_LARGE, 400);
  }
  // Pin the body read to the exact version we just HEADed (caller-requested, or
  // whatever the HEAD resolved) so validation and the caller's OCR see identical
  // bytes even if the key is overwritten mid-pipeline.
  const pinnedVersion = versionId || meta.versionId || null;
  if (!pinnedVersion) throw new QlueError('Versioned upload storage is required for safe PDF processing.', ERROR_CODES.INVALID_FILE_TYPE, 400);
  const buffer = await s3.getObject(bucket, key, pinnedVersion, { maxBytes });
  if (!buffer) {
    throw new QlueError('The uploaded file could not be read.', ERROR_CODES.INVALID_FILE_TYPE, 400);
  }
  const { pages } = await assertValidPdf(buffer, { maxBytes, maxPages });
  return { pages, versionId: pinnedVersion };
}

module.exports = {
  looksLikePdf,
  isEncryptedPdf,
  countPdfPages,
  pdfStructure,
  validateDeclaredSize,
  assertValidPdf,
  assertValidS3Pdf,
  MAX_RESUME_PDF_BYTES,
  MAX_RESUME_PDF_PAGES,
  MAX_JD_PDF_BYTES,
  MAX_JD_PDF_PAGES
};
