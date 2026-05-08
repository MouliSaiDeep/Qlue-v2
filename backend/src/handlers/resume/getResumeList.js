const { getResumesByUserId } = require('../../models/resume');
const { success, unauthorized, internalError } = require('../../lib/response');

/**
 * AWS Lambda Handler: GET /resume
 */
exports.handler = async (event) => {
    try {
        const authorizer = event.requestContext?.authorizer;
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;

        if (!userId) {
            return unauthorized('Missing user context');
        }

        const resumes = await getResumesByUserId(userId);
        
        // Include parsedData so the UI remains consistent after refreshes
        const resumeList = resumes.map(item => ({
            resumeId: item.resumeId,
            fileName: item.fileName,
            fileSize: item.fileSize,
            status: item.status,
            uploadedAt: item.uploadedAt,
            parsedAt: item.parsedAt,
            isActive: item.isActive,
            failReason: item.failReason || null,
            parsedData: item.parsedData || null
        }));

        return success({
            resumes: resumeList,
            count: resumeList.length,
            maxAllowed: 5
        });

    } catch (error) {
        console.error('Get Resume List Error:', error);
        return internalError(error.message);
    }
};
