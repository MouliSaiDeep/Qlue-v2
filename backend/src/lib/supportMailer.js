const diagnostics=require('./logger').safeConsole;
/**
 * Best-effort support-ticket email to the developer inbox via Amazon SES.
 *
 * DEPLOY-GATED: this only sends when (a) SUPPORT_EMAIL is configured, (b) a
 * verified SES sender identity is available (SUPPORT_FROM_EMAIL, falling back to
 * SUPPORT_EMAIL when the inbox itself is the verified identity), and (c) the
 * @aws-sdk/client-ses package is bundled in the deployed layer. In local/test
 * builds the package is absent, so the require below fails softly and we return
 * { sent:false } without throwing.
 *
 * The DynamoDB ticket (models/support) is the durable record; this email is a
 * convenience notification only. The caller must treat any non-sent / thrown
 * result as non-fatal — never fail the user's request because the dev email
 * could not be dispatched.
 */

let cachedClient = null;

function getClient(SESClient) {
    if (!cachedClient) {
        cachedClient = new SESClient({ maxAttempts: 1, region: process.env.AWS_REGION || 'us-east-1' });
    }
    return cachedClient;
}

async function sendSupportEmail({ ticketId, userId, email, subject, message }) {
    const to = process.env.SUPPORT_EMAIL;
    // From MUST be an SES-verified identity. A single-identity setup verifies
    // the dev inbox itself and uses it as both sender and recipient.
    const from = process.env.SUPPORT_FROM_EMAIL || to;
    if (!to || !from) return { sent: false, reason: 'NO_SUPPORT_EMAIL' };

    let SESClient;
    let SendEmailCommand;
    try {
        ({ SESClient, SendEmailCommand } = require('@aws-sdk/client-ses'));
    } catch (_) {
        // Package not bundled in this build (expected locally / in tests).
        return { sent: false, reason: 'SES_UNAVAILABLE' };
    }

    const safeSubject = `[Qlue Support] ${subject}`.substring(0, 180);
    // Let the dev reply straight to the user when they gave a usable address.
    const replyTo = email && /.+@.+\..+/.test(email) ? [email] : undefined;
    const bodyText =
        'A user submitted a support request from the app.\n\n' +
        `Ticket:    ${ticketId}\n` +
        `User ID:   ${userId}\n` +
        (email ? `User email: ${email}\n` : '') +
        `\nSubject: ${subject}\n\n` +
        `Message:\n${message}\n`;

    try {
        const client = getClient(SESClient);
        await require('./paidWork').beforePaidCall('support');
        await require('./deadline').sendBounded(client,new SendEmailCommand({
            Source: from,
            Destination: { ToAddresses: [to] },
            ...(replyTo ? { ReplyToAddresses: replyTo } : {}),
            Message: {
                Subject: { Data: safeSubject, Charset: 'UTF-8' },
                Body: { Text: { Data: bodyText, Charset: 'UTF-8' } }
            }
        }));
        return { sent: true };
    } catch (err) {
        // Unverified identity / SES not enabled in the account / sandbox mode.
        // Log the error NAME only (no user content) — the ticket is already saved.
        diagnostics.warn(`Support email send failed (${err.name || 'Error'}) — ticket already stored.`);
        return { sent: false, reason: 'SEND_FAILED' };
    }
}

module.exports = { sendSupportEmail };
