const { getResumesByUserId } = require('../../models/resume');

/**
 * AWS Lambda Handler: GET /resume
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

        const resumes = await getResumesByUserId(userId);
        
        // Map to exclude large blobs (parsedData) for list view efficiency
        const resumeList = resumes.map(item => ({
            resumeId: item.resumeId,
            fileName: item.fileName,
            fileSize: item.fileSize,
            status: item.status,
            uploadedAt: item.uploadedAt,
            parsedAt: item.parsedAt,
            isActive: item.isActive,
            failReason: item.failReason || null
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({
                resumes: resumeList,
                count: resumeList.length,
                maxAllowed: 4
            })
        };

    } catch (error) {
        console.error('Get Resume List Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
