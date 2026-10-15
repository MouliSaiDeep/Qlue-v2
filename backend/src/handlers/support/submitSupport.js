const diagnostics=require('../../lib/logger').safeConsole;
const { createSupportTicket } = require('../../models/support');
const { sendSupportEmail } = require('../../lib/supportMailer');
const { getUserById } = require('../../models/user');

// Keep the stored/emailed payload bounded so a malformed or abusive client can
// neither bloat the table item nor the dev email.
const SUBJECT_MAX = 200;
const MESSAGE_MAX = 5000;

/**
 * AWS Lambda Handler: POST /support
 *
 * Replaces the old mailto: hand-off (which bounced the user out to their email
 * app) with a truly in-app flow: the message is stored server-side and the dev
 * inbox is notified. Authenticated — the ticket is attributed to the caller's
 * uid, never a client-supplied id.
 */
exports.handler = async (event) => {
    try {
        const authorizer = event.requestContext?.authorizer;
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;
        if (!userId) {
            return { statusCode: 401, body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'Please sign in to contact support.' }) };
        }

        await require('../../lib/deletionJob').assertNotDeleting(userId);
        const body = JSON.parse(event.body || '{}');
        const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
        const message = typeof body.message === 'string' ? body.message.trim() : '';

        if (!subject || !message) {
            return { statusCode: 400, body: JSON.stringify({ error: 'INVALID_INPUT', message: 'Please add a subject and a message.' }) };
        }
        if (subject.length > SUBJECT_MAX || message.length > MESSAGE_MAX) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'INPUT_TOO_LONG',
                    message: `Keep the subject under ${SUBJECT_MAX} characters and the message under ${MESSAGE_MAX}.`
                })
            };
        }

        await require('../../lib/paidWork').assertRuntimeEnabled('support');
        const quota=await require('../../lib/quota').reserveQuota(userId,'support');
        if(!quota.allowed) return require('../../lib/response').tooManyRequests('Daily support submission limit reached','QUOTA_EXCEEDED');
        // Best-effort: enrich the ticket with the caller's email for replies, but
        // a profile-read failure must not block submission.
        let email;
        try {
            const user = await getUserById(userId);
            email = user?.email;
        } catch (profileErr) {
            diagnostics.warn(`Support: profile lookup failed for ${userId}:`, profileErr.name);
        }

        // Durable write first — this is the source of truth for the ticket.
        const { ticketId, createdAt } = await createSupportTicket({ userId, email, subject, message });

        // Notify the dev inbox (deploy-gated). Any failure here is swallowed:
        // the ticket is already safely stored, so the user still gets a success.
        let emailed = false;
        try {
            const result = await sendSupportEmail({ ticketId, userId, email, subject, message });
            emailed = !!result?.sent;
        } catch (mailErr) {
            diagnostics.warn(`Support: email dispatch error for ticket ${ticketId}:`, mailErr.name);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                ticketId,
                createdAt,
                emailed,
                message: "Thanks — your message has been saved for support."
            })
        };
    } catch (err) {
        diagnostics.error('Support submission failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Could not send your message. Please try again.' }) };
    }
};

const originalHandler = exports.handler;
exports.handler = (event,context) => require('../../lib/deadline').withDeadline(context, () => originalHandler(event,context), {maxMs:25000,userId:event.userId || event.requestContext?.authorizer?.uid});
