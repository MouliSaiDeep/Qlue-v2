const { generatePresignedUrl: getSignedUrl } = require('../../lib/s3');
const { getResumesByUserId, createResume } = require('../../models/resume');
const { randomUUID } = require('crypto');
const { success, badRequest, unauthorized, conflict, internalError } = require('../../lib/response');

const BUCKET_NAME = process.env.RESUMES_BUCKET || 'qlue-resumes';

/**
 * AWS Lambda Handler: POST /resume/presigned-url
 */
exports.handler = async (event) => {
    try {
        const authorizer = event.requestContext?.authorizer;
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;

        if (!userId) {
            return unauthorized('Missing user context');
        }

        const body = JSON.parse(event.body || '{}');
        const { fileName, fileSize, fileHash } = body;

        if (!fileName || !fileSize || !fileHash) {
            return badRequest('Missing fileName, fileSize, or fileHash');
        }

        if (!fileName.toLowerCase().endsWith('.pdf')) {
            return badRequest('Only .pdf files are allowed', 'INVALID_FILE_TYPE');
        }

        // 1. Check user's resume limit (Max 5)
        const existingResumes = await getResumesByUserId(userId);
        if (existingResumes.length >= 5) {
            return conflict('Maximum of 5 resumes allowed', 'LIMIT_EXCEEDED');
        }

        // 2. Check for duplicate content via hash
        const duplicate = existingResumes.find(r => r.fileHash === fileHash);
        if (duplicate) {
            return conflict('This resume has already been uploaded', 'DUPLICATE_RESUME');
        }

        const resumeId = randomUUID();
        const timestamp = Date.now();
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const s3Key = `resumes/${userId}/${timestamp}_${sanitizedFileName}`;

        // 3. Generate presigned URL for PUT with specific content type
        const uploadUrl = await getSignedUrl(BUCKET_NAME, s3Key, 'putObject', 900, 'application/pdf');

        // 4. Create record in DynamoDB with UPLOADING status
        await createResume({
            resumeId,
            userId,
            fileName,
            fileSize,
            fileHash,
            s3Key,
            status: 'UPLOADING'
        });

        return success({
            uploadUrl,
            resumeId,
            s3Key,
            expiresIn: 900
        });

    } catch (error) {
        console.error('Generate Presigned URL Error:', error);
        return internalError(error.message);
    }
};
