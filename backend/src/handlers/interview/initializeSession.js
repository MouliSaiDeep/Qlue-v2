const diagnostics=require('../../lib/logger').safeConsole;
const { createSession, getActiveSessionForUser, INTERVIEW_STATES } = require('../../models/session');
const { getUserById } = require('../../models/user');
const { getUserTier, isPremiumVoiceAllowed, reserveQuota, refundQuota, assertServiceEnabled, assertAccountActive, ACTIONS } = require('../../lib/quota');
const { QlueError } = require('../../lib/errors');
const { randomUUID } = require('crypto');

// I-10: one canonical module contract. Downstream (generateQuestion's prompt
// switch, scoring, feedback) only understands these exact types. `SELF_INTRO`
// is a legacy alias that previously fell through to the generic RESUME prompt
// in question generation — normalize it to the canonical `INTRO` here so a
// single stored value drives every branch.
const VALID_MODULE_TYPES = new Set(['RESUME', 'HR', 'JD', 'WEBSITE', 'INTRO']);

function normalizeModuleType(raw) {
    const m = String(raw || 'RESUME').trim().toUpperCase();
    return m === 'SELF_INTRO' ? 'INTRO' : m;
}

// I-10: a resume-grounded module (RESUME/JD) must have an OWNED resume whose
// parsing has completed. Textract sets status PARSED and writes parsedData on
// success; a PENDING/PARSING/FAILED resume has no usable content, so starting
// an interview on it produced a hollow, generic session.
function isResumeParsed(resume) {
    if (!resume) return false;
    const pd = resume.parsedData;
    return resume.status === 'PARSED' && !!pd && typeof pd === 'object' && Object.keys(pd).length > 0;
}

exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        // Custom Authorizer returns claims in authorizer object directly (uid or principalId)
        const authorizer = event.requestContext?.authorizer;
        // SECURITY: no body.userId fallback — a client-supplied uid would let a
        // caller create sessions (and pull resume context) as another user.
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;
        const moduleType = normalizeModuleType(body.moduleType);

        if (!userId) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized. User ID required.' }) };
        }

        if (![true, 'true'].includes(authorizer?.emailVerified ?? authorizer?.claims?.email_verified)) {
            return { statusCode: 403, body: JSON.stringify({ error: 'EMAIL_VERIFICATION_REQUIRED', message: 'Verify your email before starting an interview.' }) };
        }

        // R-02 stop switch: an interview turn drives Bedrock + Polly. Honor the
        // global/per-action admission cutoff here, before any read or paid work,
        // so ops can hard-halt interview spend without a redeploy. Distinct from
        // the per-user daily quota reserved in Phase C below.
        try {
            assertServiceEnabled(ACTIONS.INTERVIEW);
        } catch (pausedErr) {
            if (pausedErr instanceof QlueError) {
                return { statusCode: pausedErr.statusCode || 503, body: JSON.stringify({ error: pausedErr.code, message: pausedErr.message }) };
            }
            throw pausedErr;
        }

        // [Mouli Week 4: Voice Selection] Fetch user's preferred voice + tier
        diagnostics.debug(`Fetching user profile for ${userId}...`);
        const user = await getUserById(userId);
        // R-03: refuse to start a new (stateful, paid) session for an account
        // that is being deleted — otherwise an init racing the wipe would
        // re-create session/lock rows that outlive the teardown.
        try {
            assertAccountActive(user);
        } catch (deletingErr) {
            if (deletingErr instanceof QlueError) {
                return { statusCode: deletingErr.statusCode || 409, body: JSON.stringify({ error: deletingErr.code, message: deletingErr.message }) };
            }
            throw deletingErr;
        }
        const voiceId = body.voiceId || user?.voiceId || 'Tiffany';
        const tier = getUserTier(user);

        // ---- Phase B: cheap validations (no quota consumed, no paid work) ----

        // [Mouli Week 4: Concurrency Lock] Pre-check is for UX (nice 409 + zombie
        // cleanup); the ATOMIC lock inside createSession is the real race guard.
        diagnostics.debug(`Checking for active sessions for ${userId}...`);
        const activeSession = await getActiveSessionForUser(userId);
        if (activeSession) {
            if (body.force) {
                // Verify the active session belongs to this user before terminating
                if (activeSession.userId !== userId) {
                    diagnostics.error(`User ${userId} attempted to terminate session owned by ${activeSession.userId}`);
                    return { statusCode: 403, body: JSON.stringify({ error: 'Cannot terminate another user\'s session' }) };
                }
                diagnostics.info(`Force terminating existing session ${activeSession.sessionId} for ${userId}`);
                const terminateSession = require('./terminateSession');
                // BE-BUG #22 FIX: Pass requestContext so terminateSession can perform ownership check
                await terminateSession.handler({
                    requestContext: { authorizer: { uid: userId } },
                    body: JSON.stringify({ sessionId: activeSession.sessionId, reason: 'USER_INITIATED' })
                });
            } else {
                diagnostics.warn(`Concurrent session detected for ${userId}: ${activeSession.sessionId}`);
                return {
                    statusCode: 409,
                    body: JSON.stringify({
                        error: 'ConcurrentSessionError',
                        message: 'User already has an active interview session.',
                        activeSessionId: activeSession.sessionId
                    })
                };
            }
        }

        // I-10: validate the module contract BEFORE consuming quota or doing
        // paid work, so a malformed request never burns a daily interview slot.
        if (!VALID_MODULE_TYPES.has(moduleType)) {
            return { statusCode: 400, body: JSON.stringify({ error: 'INVALID_MODULE_TYPE', message: 'Unsupported interview module.' }) };
        }

        // SECURITY + I-10: resumeId arrives from the client and its parsed
        // contents are injected into every interview prompt. Fetch it ONCE here
        // (reused for the session snapshot below) and require ownership — a
        // caller must not pass someone else's resumeId and have the AI read that
        // resume back to them. RESUME/JD additionally require a PARSED resume.
        let ownedResume = null;
        if (body.resumeId) {
            const { getResumeById } = require('../../models/resume');
            ownedResume = await getResumeById(body.resumeId);
            if (!ownedResume || ownedResume.userId !== userId) {
                return { statusCode: 403, body: JSON.stringify({ error: 'Resume not found or not owned by this user.' }) };
            }
        }

        // Module prerequisites — resume-grounded modules need an owned, parsed
        // resume; WEBSITE needs a URL; JD needs an analysis bound to that resume.
        if (moduleType === 'RESUME' || moduleType === 'JD') {
            if (!body.resumeId) {
                return { statusCode: 400, body: JSON.stringify({ error: 'RESUME_REQUIRED', message: 'Select a resume before starting this interview.' }) };
            }
            if (!isResumeParsed(ownedResume)) {
                return { statusCode: 400, body: JSON.stringify({ error: 'RESUME_NOT_READY', message: 'This resume is still processing. Wait for parsing to finish, then try again.' }) };
            }
        }

        if (moduleType === 'WEBSITE' && !body.websiteUrl) {
            return { statusCode: 400, body: JSON.stringify({ error: 'WEBSITE module requires a websiteUrl.' }) };
        }

        let jd = null;
        if (moduleType === 'JD') {
            jd = user?.latestJdAnalysis;
            if (!jd?.jdSummary) {
                return { statusCode: 400, body: JSON.stringify({ error: 'No job match analysis found. Analyze a job posting first.' }) };
            }
            // I-10: the stored analysis is bound to the resume it was computed
            // against (analyzeJobMatch persists `resumeId`). If the user changed
            // resumes after analyzing, the cached match no longer describes the
            // selected resume — require a fresh analysis rather than interviewing
            // against stale data. Legacy analyses saved before this binding have
            // no resumeId and are allowed through for backward compatibility.
            if (jd.resumeId && jd.resumeId !== body.resumeId) {
                return { statusCode: 400, body: JSON.stringify({ error: 'JD_RESUME_MISMATCH', message: 'Your job match analysis was run against a different resume. Re-analyze the job posting with the selected resume.' }) };
            }
        }

        // ---- Phase C: reserve the daily interview quota (tier-derived) ----
        // Atomic conditional counter in the UsageTable; concurrent inits cannot
        // push a user past the cap. Refunded below if anything downstream fails.
        const reservation = await reserveQuota(userId, ACTIONS.INTERVIEW, tier);
        if (!reservation.allowed) {
            diagnostics.warn(`Daily interview quota reached for ${userId} (tier=${tier}, limit=${reservation.limit})`);
            return {
                statusCode: 429,
                body: JSON.stringify({
                    error: 'QUOTA_EXCEEDED',
                    message: `You've reached your daily limit of ${reservation.limit} interviews. It resets tomorrow.`,
                    usage: {
                        interviewsUsed: reservation.used,
                        interviewsLimit: reservation.limit,
                        interviewsRemaining: 0
                    }
                })
            };
        }

        // ---- Phase D: paid work + create. Any failure refunds the slot. ----
        try {
            const sessionId = randomUUID();
            const itemData = { voiceId };
            if (body.resumeId) itemData.resumeId = body.resumeId;
            if (body.websiteUrl) itemData.websiteUrl = body.websiteUrl;

            // VOICE MODE: server-side eligibility (finding 3). The client may
            // REQUEST 'premium', but the tier decides. 'premium' unlocks
            // generative voices; 'cost_saver' is pinned to the cheaper neural
            // engine (a client can no longer force a generative engine).
            const requestedPremium = body.voiceMode === 'premium';
            const voiceMode = (requestedPremium && isPremiumVoiceAllowed(tier)) ? 'premium' : 'cost_saver';
            itemData.voiceMode = voiceMode;
            itemData.engine = (voiceMode === 'premium') ? (body.engine || 'generative') : 'neural';

            // WEBSITE MODULE: snapshot scraped content + a target concept onto
            // the session (prefer the scrape validateWebsite just cached for this
            // exact URL — no second scrape, no rate limits, instant init).
            if (moduleType === 'WEBSITE') {
                const cached = user?.latestWebsiteScrape;
                if (cached?.url === body.websiteUrl && cached?.content) {
                    itemData.scrapedSummary = cached.content.substring(0, 6000);
                    itemData.targetConcept = 'the main topic';
                    diagnostics.log('WEBSITE init: using cached validated scrape');
                } else {
                    try {
                        const { fetchAndCleanContent } = require('../../lib/scraper');
                        const scraped = await fetchAndCleanContent(body.websiteUrl);
                        itemData.scrapedSummary = (scraped.content || '').substring(0, 6000);
                        itemData.targetConcept = (scraped.title || 'the main topic')
                            .replace(/\s*[|\-–].*$/, '') // strip " | SiteName" tails
                            .trim()
                            .substring(0, 80) || 'the main topic';
                    } catch (scrapeErr) {
                        diagnostics.error('WEBSITE init scrape failed:', scrapeErr.name);
                        await refundQuota(userId, ACTIONS.INTERVIEW);
                        return { statusCode: 400, body: JSON.stringify({ error: 'Could not read that website. Try a different tutorial or article link.' }) };
                    }
                }
            }

            // JD MODULE fields (prerequisites already validated in Phase B).
            if (moduleType === 'JD') {
                itemData.jdSummary = jd.jdSummary;
                itemData.jdRoleTitle = jd.roleTitle || 'the role';
                itemData.jdMatchScore = jd.matchScore;
                itemData.analysisId=jd.analysisId;itemData.resumeRevision=jd.resumeRevision;itemData.jdDigest=jd.jdDigest;
            }

            // PERF-FIX #5: Snapshot per-turn LLM context onto the session once at
            // init, so the async worker does not re-read the resume and user items
            // from DynamoDB on every single turn.
            // I-10: profile fields are persisted as displayName/profession by
            // every auth/profile API; the legacy name/currentRole keys are never
            // written, so snapshotting them produced an always-empty userName and
            // the AI could never address the candidate by name. Prefer the
            // canonical fields, falling back to the legacy keys for any
            // pre-migration rows that still carry them.
            const userName = user?.displayName || user?.name;
            const userRole = user?.profession || user?.currentRole;
            if (userName) itemData.userName = userName;
            if (userRole) itemData.userCurrentRole = userRole;
            // Reuse the resume already fetched (and ownership-checked) in Phase B
            // instead of issuing a second DynamoDB read for the same item.
            if ((moduleType === 'RESUME' || moduleType === 'JD') && ownedResume) {
                try {
                    const { extractResumeSummary } = require('./generateQuestion');
                    itemData.resumeSummary = extractResumeSummary(ownedResume.parsedData || ownedResume);
                } catch (snapshotErr) {
                    // Non-fatal: the worker falls back to per-turn resume fetches.
                    diagnostics.warn(`Resume snapshot failed for session init (${body.resumeId}):`, snapshotErr.name);
                }
            }

            diagnostics.info(`Creating new session ${sessionId} for ${userId} (Module: ${moduleType})`);
            // Atomic per-user active-session lock lives inside createSession. A
            // conflict here means a concurrent init won the race → 409 + refund.
            try {
                await createSession(sessionId, userId, moduleType, itemData);
            } catch (createErr) {
                if (createErr.code === 'ACTIVE_SESSION_EXISTS') {
                    diagnostics.warn(`Atomic active-session lock conflict for ${userId}`);
                    await refundQuota(userId, ACTIONS.INTERVIEW);
                    // I-06: return activeSessionId on the race path too, so the
                    // client's 409 handler can offer "end existing & retry"
                    // instead of dead-ending. Best-effort re-query — the winner's
                    // session may still be settling, so a null id is tolerated.
                    let activeSessionId;
                    try {
                        const existing = await getActiveSessionForUser(userId);
                        activeSessionId = existing?.sessionId;
                    } catch (lookupErr) {
                        diagnostics.warn(`Active-session re-query after lock conflict failed for ${userId}:`, lookupErr.name);
                    }
                    return {
                        statusCode: 409,
                        body: JSON.stringify({
                            error: 'ConcurrentSessionError',
                            message: 'User already has an active interview session.',
                            ...(activeSessionId ? { activeSessionId } : {})
                        })
                    };
                }
                throw createErr; // refunded by the outer catch below
            }

            // WEBSOCKET_ENDPOINT is set by SAM template as https://... but frontend needs wss://
            const wsHttpEndpoint = process.env.WEBSOCKET_ENDPOINT || '';
            let wsUrl = '';
            if (wsHttpEndpoint) {
                if (wsHttpEndpoint.startsWith('https://')) {
                    wsUrl = wsHttpEndpoint.replace('https://', 'wss://');
                } else if (wsHttpEndpoint.startsWith('http://')) {
                    wsUrl = wsHttpEndpoint.replace('http://', 'ws://');
                } else {
                    wsUrl = wsHttpEndpoint;
                }
            } else {
                wsUrl = process.env.WS_FALLBACK_URL || '';
            }

            return {
                statusCode: 200,
                body: JSON.stringify({
                    sessionId,
                    answerAudioSupported:false,
                    state: INTERVIEW_STATES.INITIALIZING,
                    wsUrl,
                    // Additive, backward-compatible: lets the client show remaining
                    // free interviews without a second round-trip.
                    usage: {
                        interviewsUsed: reservation.used,
                        interviewsLimit: reservation.limit,
                        interviewsRemaining: reservation.remaining
                    }
                })
            };
        } catch (innerErr) {
            // Any unexpected failure after the quota was reserved → refund the
            // slot before bubbling to the generic 500 handler.
            await refundQuota(userId, ACTIONS.INTERVIEW);
            throw innerErr;
        }
    } catch (err) {
        diagnostics.error('Initialization Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Could not start the session. Please try again.' }) };
    }
};

const initialization=exports.handler;
exports.handler=(event,context)=>require('../../lib/deadline').withDeadline(context,()=>initialization(event),{maxMs:25000,userId:event.requestContext?.authorizer?.uid});
