const { generatePresignedUrl } = require('../../lib/s3');
const { randomUUID } = require('crypto');
const { success, badRequest, unauthorized, internalError } = require('../../lib/response');

// JD PDFs are transient inputs, not long-lived records like resumes, so they
// live in the scraped-content bucket (which has a short lifecycle policy) under
// a per-user prefix.
const BUCKET_NAME = process.env.SCRAPED_CONTENT_BUCKET || process.env.RESUMES_BUCKET;

// Reject oversized uploads before they cost a Textract job (10 MB is generous
// for a job description).
const MAX_JD_PDF_BYTES = 10 * 1024 * 1024;

/**
 * POST /jd/upload-url
 * Issues a presigned PUT URL for a job-description PDF. The client uploads the
 * file directly to S3, then calls /jd/analyze with the returned jobPdfKey.
 */
exports.handler = async (event) => {
    try {
        const authorizer = event.requestContext?.authorizer;
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;
        if (!userId) return unauthorized('Missing user context');

        if (!BUCKET_NAME) {
            console.error('No bucket configured for JD uploads');
            return internalError('JD upload is not configured');
        }

        const body = JSON.parse(event.body || '{}');
        const { fileName, fileSize } = body;

        if (!fileName || !fileSize) {
            return badRequest('Missing fileName or fileSize');
        }
        if (!String(fileName).toLowerCase().endsWith('.pdf')) {
            return badRequest('Only .pdf files are allowed', 'INVALID_FILE_TYPE');
        }
        if (Number(fileSize) > MAX_JD_PDF_BYTES) {
            return badRequest('File is too large (max 10 MB)', 'FILE_TOO_LARGE');
        }

        const sanitized = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const jobPdfKey = `jd/${userId}/${Date.now()}_${randomUUID()}_${sanitized}`;

        const uploadUrl = await generatePresignedUrl(
            BUCKET_NAME, jobPdfKey, 'putObject', 900, 'application/pdf'
        );

        return success({ uploadUrl, jobPdfKey, expiresIn: 900 });
    } catch (error) {
        console.error('Generate JD Upload URL Error:', error);
        return internalError('Could not start the upload. Please try again.');
    }
};
