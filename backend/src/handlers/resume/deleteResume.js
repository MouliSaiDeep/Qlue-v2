const { deleteObject } = require('../../lib/s3');
const { getResumeById, deleteResumeRecord, getResumesByUserId, updateResumeParsingResult } = require('../../models/resume');
const { setActiveResumeId, getUserById } = require('../../models/user');
const { update } = require('../../lib/dynamodb');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';
const BUCKET_NAME = process.env.RESUMES_BUCKET || 'qlue-resumes';

/**
 * AWS Lambda Handler: DELETE /resume/{resumeId}
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

        const resumeId = event.pathParameters?.resumeId;
        if (!resumeId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'BAD_REQUEST', message: 'resumeId is required' })
            };
        }

        const resume = await getResumeById(resumeId);
        if (!resume || resume.userId !== userId) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'NOT_FOUND', message: 'Resume not found' })
            };
        }

        // 1. Delete from S3
        if (resume.s3Key) {
            try {
                await deleteObject(BUCKET_NAME, resume.s3Key);
            } catch (s3Err) {
                console.error("S3 deletion failed during resume delete:", s3Err.message);
            }
        }

        // 2. Delete from DynamoDB
        await deleteResumeRecord(resumeId);

        // 3. Handle Active Resume Handover
        if (resume.isActive) {
            const others = await getResumesByUserId(userId);
            if (others.length > 0) {
                const nextActive = others[0];
                await update(RESUMES_TABLE, { resumeId: nextActive.resumeId }, 'SET isActive = :ia', { ':ia': true });
                await setActiveResumeId(userId, nextActive.resumeId);
            } else {
                // No resumes left
                await update(process.env.USERS_TABLE || 'qlue-users', { userId }, 'REMOVE activeResumeId');
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Resume deleted successfully' })
        };

    } catch (error) {
        console.error('Delete Resume Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: error.message })
        };
    }
};
