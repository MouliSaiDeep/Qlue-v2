const RETRYABLE = new Set(['PENDING','UPLOADING','FAILED']);
const isRetryableUpload = resume => RETRYABLE.has(String(resume?.status || '').toUpperCase());
module.exports = {isRetryableUpload};
