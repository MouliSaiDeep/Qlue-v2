const { put } = require('../lib/dynamodb');
const { randomUUID } = require('crypto');

const SUPPORT_TABLE = process.env.SUPPORT_TABLE || 'qlue-support';

/**
 * Persists an in-app Help & Support message. The DynamoDB row is the durable
 * source of truth for a ticket — the dev-inbox email (see lib/supportMailer) is
 * only a best-effort convenience notification layered on top, so a ticket is
 * never lost just because email delivery is unconfigured or fails.
 *
 * Keyed by a random ticketId; userId is carried as a plain attribute (a GSI can
 * be added later if per-user ticket history is ever needed).
 */
async function createSupportTicket({ userId, email, subject, message }) {
    const now = new Date().toISOString();
    const ticketId = randomUUID();
    const item = {
        ticketId,
        userId,
        subject,
        message,
        status: 'OPEN',
        createdAt: now,
        updatedAt: now
    };
    // Only store an email when we actually have one — avoids a null attribute.
    if (email) item.email = email;

    const res = await put(SUPPORT_TABLE, item);
    if (!res.success) {
        throw new Error(`Failed to store support ticket: ${res.error?.message || 'Unknown error'}`);
    }
    return { ticketId, createdAt: now };
}

module.exports = { createSupportTicket, SUPPORT_TABLE };
