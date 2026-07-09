const { fetchAndCleanContent } = require('../../lib/scraper');
const { invokeModel } = require('../../lib/bedrock');
const { getResumeById } = require('../../models/resume');
const { saveJdAnalysis } = require('../../models/user');
const { extractResumeSummary } = require('../interview/generateQuestion');
const { success, badRequest, unauthorized, forbidden, notFound, internalError } = require('../../lib/response');

// Minimum profile-match score required to unlock the JD practice interview.
const JD_MATCH_THRESHOLD = parseInt(process.env.JD_MATCH_THRESHOLD || '60', 10);

/**
 * JD MODULE — step 1 of 2.
 * Scrapes a job posting URL, compares it against the user's selected resume
 * with the LLM, produces a profile match score, and stores the analysis on
 * the user record. initializeSession (moduleType JD) later snapshots the
 * stored jdSummary into the interview session.
 */
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const authorizer = event.requestContext?.authorizer;
    const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;
    if (!userId) {
      return unauthorized('Unauthorized. User ID required.');
    }

    const { jobUrl, jobText, resumeId } = body;
    if (!resumeId) {
      return badRequest('resumeId is required');
    }
    // Either a URL to scrape OR pasted job-description text. The pasted-text
    // path is the guaranteed fallback for sites that block scrapers
    // (LinkedIn, some Indeed pages, login-walled boards).
    const hasPastedText = typeof jobText === 'string' && jobText.trim().length >= 100;
    if (!jobUrl && !hasPastedText) {
      return badRequest('Provide either a job posting URL or paste the job description (at least 100 characters).');
    }
    if (jobUrl) {
      try {
        new URL(jobUrl);
      } catch (e) {
        return badRequest('Invalid job posting URL format');
      }
    }

    // 1. Resume (with ownership check)
    const resume = await getResumeById(resumeId);
    if (!resume) return notFound('Resume not found');
    if (resume.userId && resume.userId !== userId) {
      return forbidden('Resume does not belong to this user');
    }
    const resumeSummary = extractResumeSummary(resume.parsedData || resume);

    // 2. Obtain the job description: pasted text wins (100% reliable); else scrape.
    let jdContent;
    if (hasPastedText) {
      jdContent = jobText.trim();
    } else {
      try {
        const scraped = await fetchAndCleanContent(jobUrl);
        jdContent = scraped.content;
      } catch (scrapeErr) {
        console.error('JD scrape failed:', scrapeErr);
        return success({
          analyzed: false,
          canPasteText: true, // signal the client to offer the paste fallback
          reason: scrapeErr.message && scrapeErr.message.includes('Paste')
            ? scrapeErr.message
            : 'Could not read this job posting — some sites (like LinkedIn) block automated access. Paste the job description text instead.'
        });
      }
    }

    // 3. LLM comparison
    const systemPrompt = `You are a technical recruiter. Compare the CANDIDATE RESUME against the JOB DESCRIPTION and produce a strict JSON object (no markdown, no prose) with exactly these keys:
{
  "isJobPosting": boolean,          // false if the page is clearly not a job description
  "matchScore": number,             // 0-100 realistic fit of this candidate for this role
  "roleTitle": "string",            // job title from the posting, or "Unknown Role"
  "matchedSkills": ["string"],      // up to 6 requirements the candidate satisfies
  "missingSkills": ["string"],      // up to 6 requirements the candidate lacks
  "verdict": "string",              // one encouraging sentence summarizing the fit
  "jdSummary": "string"             // condensed job description: role, seniority, core responsibilities and requirements, max 1200 characters
}
Score honestly: 80+ only for strong overlap of core requirements, 50-79 for partial fit, below 50 for weak fit.`;

    const messages = [{
      role: 'user',
      content: [{
        text: `JOB DESCRIPTION (scraped):\n${jdContent.substring(0, 6000)}\n\nCANDIDATE RESUME:\n${resumeSummary.substring(0, 3000)}`
      }]
    }];

    const bedrockResult = await invokeModel(undefined, { system: systemPrompt, messages });
    const responseText = bedrockResult.content?.[0]?.text || '';

    let analysis;
    try {
      analysis = JSON.parse(responseText.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error('JD analysis parse failure:', responseText.substring(0, 200));
      return internalError('Could not analyze the job posting. Please try again.');
    }

    if (analysis.isJobPosting === false) {
      return success({
        analyzed: false,
        reason: 'This link does not look like a job posting. Paste a direct link to a job description.'
      });
    }

    const matchScore = Math.max(0, Math.min(100, Math.round(Number(analysis.matchScore) || 0)));
    const eligible = matchScore >= JD_MATCH_THRESHOLD;

    // 4. Persist for initializeSession (JD module) to pick up
    await saveJdAnalysis(userId, {
      jobUrl: jobUrl || '(pasted text)',
      resumeId,
      roleTitle: analysis.roleTitle || 'Unknown Role',
      matchScore,
      jdSummary: (analysis.jdSummary || '').substring(0, 1500)
    });

    return success({
      analyzed: true,
      matchScore,
      threshold: JD_MATCH_THRESHOLD,
      eligible,
      roleTitle: analysis.roleTitle || 'Unknown Role',
      matchedSkills: (analysis.matchedSkills || []).slice(0, 6),
      missingSkills: (analysis.missingSkills || []).slice(0, 6),
      verdict: analysis.verdict || ''
    });
  } catch (err) {
    console.error('analyzeJobMatch Error:', err);
    return internalError('Job match analysis failed. Please try again.');
  }
};
