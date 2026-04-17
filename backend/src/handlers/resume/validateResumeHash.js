const { getResumesByUserId } = require('../../models/resume');

/**
 * AWS Lambda Handler: POST /resume/validate-hash
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
        const { fileHash } = body;
        if (!fileHash) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'fileHash is required' })
            };
        }

        const resumes = await getResumesByUserId(userId);
        const duplicate = resumes.find(item => item.fileHash === fileHash);

        return {
            statusCode: 200,
            body: JSON.stringify({
                isDuplicate: !!duplicate,
                existingResumeId: duplicate ? duplicate.resumeId : null,
                existingFileName: duplicate ? duplicate.fileName : null,
                uploadedAt: duplicate ? duplicate.uploadedAt : null
            })
        };

    } catch (error) {
        console.error('Validate Resume Hash Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
