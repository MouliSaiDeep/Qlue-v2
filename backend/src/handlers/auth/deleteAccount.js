const firebase = require('../../lib/firebase');
const { delete: remove, query } = require('../../lib/dynamodb');
const { deleteResumeRecord, getResumesByUserId } = require('../../models/resume');

const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';

/**
 * AWS Lambda Handler: DELETE /auth/account
 */
exports.handler = async (event) => {
    try {
        const uid = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;

        if (!uid) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'User context missing' })
            };
        }

        // 1. Delete user from Firebase Auth
        try {
            const auth = await firebase.getAuth();
            await auth.deleteUser(uid);
        } catch (firebaseErr) {
            console.warn("Firebase user deletion warning (may already be gone):", firebaseErr.message);
        }

        // 2. Fetch and delete related resumes first (DB + S3)
        try {
            const { deleteObject } = require('../../lib/s3');
            const BUCKET_NAME = process.env.RESUMES_BUCKET || 'qlue-resumes';
            const resumes = await getResumesByUserId(uid);
            
            await Promise.all(resumes.map(async (r) => {
                if (r.s3Key) {
                    try {
                        await deleteObject(BUCKET_NAME, r.s3Key);
                    } catch (s3Err) {
                        console.error(`Failed to delete S3 object for resume ${r.resumeId}:`, s3Err.message);
                    }
                }
                await deleteResumeRecord(r.resumeId);
            }));
        } catch (resumeErr) {
            console.error("Cleanup of resumes failed during account deletion:", resumeErr.message);
        }

        // 3. Delete user record from DynamoDB
        const result = await remove(USERS_TABLE, { userId: uid });

        if (!result.success) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'DB_DELETE_FAILED', details: result.error?.message })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Account and associated data deleted successfully" })
        };

    } catch (error) {
        console.error('Delete Account Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'DELETE_ACCOUNT_FAILED', details: error.message })
        };
    }
};
