const { generatePresignedUrl: getSignedUrl } = require('../../lib/s3');
const { getResumesByUserId, createResume } = require('../../models/resume');
const { randomUUID } = require('crypto');

const BUCKET_NAME = process.env.RESUMES_BUCKET || 'qlue-resumes';

/**
 * AWS Lambda Handler: POST /resume/presigned-url
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing user context' })
            };
        }

        const body = JSON.parse(event.body || '{}');
        const { fileName, fileSize, fileHash } = body;

        if (!fileName || !fileSize || !fileHash) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'Missing fileName, fileSize, or fileHash' })
            };
        }

        if (!fileName.toLowerCase().endsWith('.pdf')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'INVALID_FILE_TYPE', message: 'Only .pdf files are allowed' })
            };
        }

        // 1. Check user's resume limit (Max 4)
        const existingResumes = await getResumesByUserId(userId);
        if (existingResumes.length >= 4) {
            return {
                statusCode: 409,
                body: JSON.stringify({ error: 'LIMIT_EXCEEDED', message: 'Maximum of 4 resumes allowed' })
            };
        }

        // 2. Check for duplicate content via hash
        const duplicate = existingResumes.find(r => r.fileHash === fileHash);
        if (duplicate) {
            return {
                statusCode: 409,
                body: JSON.stringify({ 
                    error: 'DUPLICATE_RESUME', 
                    message: 'This resume has already been uploaded',
                    resumeId: duplicate.resumeId
                })
            };
        }

        const resumeId = randomUUID();
        const timestamp = Date.now();
        const s3Key = `resumes/${userId}/${timestamp}_${fileName}`;

        // 3. Generate presigned URL for PUT
        const uploadUrl = await getSignedUrl(BUCKET_NAME, s3Key, 'putObject', 900);

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

        return {
            statusCode: 200,
            body: JSON.stringify({
                uploadUrl,
                resumeId,
                s3Key,
                expiresIn: 900
            })
        };

    } catch (error) {
        console.error('Generate Presigned URL Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
