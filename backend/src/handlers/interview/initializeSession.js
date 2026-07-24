const { createSession, getActiveSessionForUser, INTERVIEW_STATES } = require('../../models/session');
const { getUserById } = require('../../models/user');
const { randomUUID } = require('crypto');

exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        // Custom Authorizer returns claims in authorizer object directly (uid or principalId)
        const authorizer = event.requestContext?.authorizer;
        // SECURITY: no body.userId fallback — a client-supplied uid would let a
        // caller create sessions (and pull resume context) as another user.
        const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;
        const moduleType = body.moduleType || 'RESUME';

        if (!userId) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized. User ID required.' }) };
        }

        // [Mouli Week 4: Voice Selection] Fetch user's preferred voice
        console.debug(`Fetching user profile for ${userId}...`);
        const user = await getUserById(userId);
        const voiceId = body.voiceId || user?.voiceId || 'Tiffany';

        // [Mouli Week 4: Concurrency Lock]
        console.debug(`Checking for active sessions for ${userId}...`);
        const activeSession = await getActiveSessionForUser(userId);
        if (activeSession) {
            if (body.force) {
                // Verify the active session belongs to this user before terminating
                if (activeSession.userId !== userId) {
                    console.error(`User ${userId} attempted to terminate session owned by ${activeSession.userId}`);
                    return {
                        statusCode: 403,
                        body: JSON.stringify({ error: 'Cannot terminate another user\'s session' })
                    };
                }
                console.info(`Force terminating existing session ${activeSession.sessionId} for ${userId}`);
                const terminateSession = require('./terminateSession');
                // BE-BUG #22 FIX: Pass requestContext so terminateSession can perform ownership check
                await terminateSession.handler({
                    requestContext: { authorizer: { uid: userId } },
                    body: JSON.stringify({ sessionId: activeSession.sessionId, reason: 'USER_INITIATED' })
                });
            } else {
                console.warn(`Concurrent session detected for ${userId}: ${activeSession.sessionId}`);
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

        // SECURITY: resumeId arrives from the client and its parsed contents are
        // injected into every interview prompt. Without an ownership check a
        // caller could pass someone else's resumeId and have the AI read that
        // resume back to them question by question.
        if (body.resumeId) {
            const { getResumeById } = require('../../models/resume');
            const ownedResume = await getResumeById(body.resumeId);
            if (!ownedResume || ownedResume.userId !== userId) {
                return { statusCode: 403, body: JSON.stringify({ error: 'Resume not found or not owned by this user.' }) };
            }
        }

        const sessionId = randomUUID();
        const itemData = { voiceId };
        if (body.resumeId) itemData.resumeId = body.resumeId;
        if (body.websiteUrl) itemData.websiteUrl = body.websiteUrl;

        // WEBSITE MODULE FIX: nothing ever scraped the URL, so the tutor ran
        // with 'no website content' and improvised unrelated questions (the
        // "asked about other topics instead of Java" bug). Scrape once at
        // init and snapshot the content + a target concept onto the session.
        if (moduleType === 'WEBSITE') {
            if (!body.websiteUrl) {
                return { statusCode: 400, body: JSON.stringify({ error: 'WEBSITE module requires a websiteUrl.' }) };
            }
            // SCRAPE-ONCE: prefer the content validateWebsite just cached for
            // this exact URL — no second scrape, no rate limits, instant init.
            const cached = user?.latestWebsiteScrape;
            if (cached?.url === body.websiteUrl && cached?.content) {
                itemData.scrapedSummary = cached.content.substring(0, 6000);
                itemData.targetConcept = 'the main topic';
                console.log('WEBSITE init: using cached validated scrape');
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
                console.error('WEBSITE init scrape failed:', scrapeErr.message);
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Could not read that website. Try a different tutorial or article link.' })
                };
            }
            }
        }
        itemData.engine = body.engine || 'neural';

        // JD MODULE: requires a resume and a prior job-match analysis
        // (stored by /jd/analyze on the user record).
        if (moduleType === 'JD') {
            if (!body.resumeId) {
                return { statusCode: 400, body: JSON.stringify({ error: 'JD module requires a resumeId.' }) };
            }
            const jd = user?.latestJdAnalysis;
            if (!jd?.jdSummary) {
                return { statusCode: 400, body: JSON.stringify({ error: 'No job match analysis found. Analyze a job posting first.' }) };
            }
            itemData.jdSummary = jd.jdSummary;
            itemData.jdRoleTitle = jd.roleTitle || 'the role';
            itemData.jdMatchScore = jd.matchScore;
        }

        // PERF-FIX #5: Snapshot per-turn LLM context onto the session once at
        // init, so the async worker does not re-read the resume and user items
        // from DynamoDB on every single turn.
        if (user?.name) itemData.userName = user.name;
        if (user?.currentRole) itemData.userCurrentRole = user.currentRole;
        if ((moduleType === 'RESUME' || moduleType === 'JD') && body.resumeId) {
            try {
                const { getResumeById } = require('../../models/resume');
                const { extractResumeSummary } = require('./generateQuestion');
                const resume = await getResumeById(body.resumeId);
                if (resume) {
                    itemData.resumeSummary = extractResumeSummary(resume.parsedData || resume);
                }
            } catch (snapshotErr) {
                // Non-fatal: the worker falls back to per-turn resume fetches.
                console.warn(`Resume snapshot failed for session init (${body.resumeId}):`, snapshotErr.message);
            }
        }

        console.info(`Creating new session ${sessionId} for ${userId} (Module: ${moduleType})`);
        await createSession(sessionId, userId, moduleType, itemData);


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
                state: INTERVIEW_STATES.INITIALIZING,
                wsUrl,
            })
        };
    } catch (err) {
        console.error('Initialization Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Could not start the session. Please try again.' }) };
    }
};
