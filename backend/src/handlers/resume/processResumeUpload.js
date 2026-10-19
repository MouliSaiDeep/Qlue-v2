const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { update } = require('../../lib/dynamodb');
const textractClient = require('../../lib/textract');
const { invokeModel } = require('../../lib/bedrock');
const { updateResumeParsingResult, getResumesByUserId, getResumeById, claimResumeParse, claimResumeExecution } = require('../../models/resume');
const s3 = require('../../lib/s3');
const pdf = require('../../lib/pdf');
const deadline = require('../../lib/deadline');
const { createHash } = require('node:crypto');
const { setActiveResumeId } = require('../../models/user');
const { success, badRequest, notFound, internalError, unauthorized } = require('../../lib/response');

const lambdaClient = new LambdaClient({ maxAttempts: 1 });
const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';
const BUCKET_NAME = process.env.RESUMES_BUCKET || 'qlue-resumes';


/**
 * AWS Lambda Handler: POST /resume/process
 *
 * Pattern: Asynchronous Self-Invocation
 * 1. API call arrives.
 * 2. If it's the external API call, update DB and trigger SELF asynchronously via Lambda 'Event' invocation.
 * 3. The 202 response is returned immediately.
 * 4. The second "worker" invocation performs the actual Textract + AI work.
 */
exports.handler = async (event, context) => {
    // Check if this is the internal "worker" invocation
    if (event.isAsyncWorker) {
        console.info(`Async worker triggered for resumeId=${event.resumeId}`);
        await processAsync(event.resumeId, event.userId, event.s3Key, event.parseAttemptId);
        return; // No need to return anything for async invoke
    }

    try {
        if (!event.body) return badRequest('Missing request body');
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        const { resumeId } = body;

        if (!resumeId) return badRequest('resumeId is required');

        const userId = event.requestContext?.authorizer?.uid;
        if (!userId) return unauthorized('Unauthorized access: Missing user ID');

        // 1. Find the database record matching this resumeId
        const resumeRecord = await getResumeById(resumeId);
        if (!resumeRecord) return notFound('Resume not found');
        if (resumeRecord.userId !== userId) return unauthorized('User does not own this resume');

        const s3Key = resumeRecord.s3Key;

        // Completed/in-flight requests are cheap no-ops, even before S3 reads.
        if (['PARSING', 'PARSED'].includes(resumeRecord.status)) {
            return success({ resumeId, status: resumeRecord.status, message: 'Resume processing already accepted.' },
                resumeRecord.status === 'PARSED' ? 200 : 202);
        }
        await require('../../lib/paidWork').assertRuntimeEnabled('resumeParse');
        const meta = await s3.headObject(BUCKET_NAME, s3Key);
        if (!meta || !meta.versionId || meta.versionId === 'null') return badRequest('The uploaded PDF is unavailable in versioned storage.');
        const size = pdf.validateDeclaredSize(meta.contentLength, pdf.MAX_RESUME_PDF_BYTES);
        if (!size.ok) return badRequest(size.message, size.code);
        const workerPayload = { isAsyncWorker: true, resumeId, userId, s3Key, s3VersionId: meta.versionId };
        const claim = await claimResumeParse(resumeId, meta.versionId, userId, workerPayload);
        if (!claim.claimed) return success({ resumeId, status: 'PARSING', message: 'Resume processing already accepted.' }, 202);
        workerPayload.parseAttemptId = claim.attemptId;

        const invokeCommand = new InvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            InvocationType: 'Event', // This makes it asynchronous
            Payload: JSON.stringify(workerPayload)
        });

        const accepted = await deadline.sendBounded(lambdaClient, invokeCommand);
        if (accepted.StatusCode !== 202) throw new Error('Resume worker delivery was not accepted');
        console.info(`Asynchronous worker triggered for ${resumeId}`);

        return success({
            resumeId,
            status: 'PARSING',
            message: 'Resume received and parsing started.'
        }, 202);

    } catch (error) {
        console.error('Process Resume Upload Error:', error);
        if (error.statusCode === 400) return badRequest(error.message, error.code);
        if (error.statusCode === 503) return require('../../lib/response').serviceUnavailable(error.message);
        return internalError('Could not start resume processing. Please try again.');
    }
};

/**
 * Runs Textract + Bedrock in the background.
 */
async function processAsync(resumeId, userId, s3Key, parseAttemptId) {
    const lease = await claimResumeExecution(resumeId, userId, s3Key, parseAttemptId);
    if (!lease.claimed) return;
    const source = { leaseOwner: lease.owner };
    try {
        // Text detection supplies the LINE blocks the AI parser actually uses.
        // The attempt token also deduplicates OCR after a lost start response.
        const token = createHash('sha256').update(JSON.stringify([resumeId, parseAttemptId || 'legacy', lease.record.parseVersion || lease.record.s3VersionId || s3Key])).digest('hex');
        const fullText = await textractClient.extractTextFromPdf(BUCKET_NAME, s3Key, {
            maxAttempts: 60, versionId: lease.record.parseVersion || lease.record.s3VersionId,
            maxBytes: pdf.MAX_RESUME_PDF_BYTES, maxPages: pdf.MAX_RESUME_PDF_PAGES,
            clientRequestToken: token
        });

        // Validate extraction quality
        const wordCount = fullText.split(/\s+/).length;
        if (wordCount < 10) { // Adjusted threshold
            throw new Error('Insufficient text extracted from document.');
        }

        // Call Bedrock to structure the data
        const parsedData = await invokeBedrockParser(fullText);

        // Update final result in DynamoDB
        const committed = await updateResumeParsingResult(resumeId, 'PARSED', parsedData, null, userId, parseAttemptId, source);
        if (!committed.success) throw committed.error || new Error('Could not save parsed resume');
        if (committed.skipped) return;

        // PROFILE AUTO-FILL: populate the user's profession and skills from
        // the parsed resume when they haven't set them manually, so the
        // profile screen isn't empty for new users.
        try {
            const { getUserById } = require('../../models/user');
            const { update } = require('../../lib/dynamodb');
            const USERS_TABLE = process.env.USERS_TABLE || 'qlue-users';
            const user = await getUserById(userId);
            const sets = [];
            const values = {};
            const latestRole = parsedData?.workExperience?.[0]?.role;
            if (latestRole && !user?.profession) {
                sets.push('profession = :profession');
                values[':profession'] = latestRole;
            }
            const parsedSkills = Array.isArray(parsedData?.skills)
                ? parsedData.skills.filter(x => typeof x === 'string' && x.trim()).slice(0, 15)
                : [];
            if (parsedSkills.length > 0 && (!Array.isArray(user?.skills) || user.skills.length === 0)) {
                sets.push('skills = :skills');
                values[':skills'] = parsedSkills;
            }
            if (sets.length > 0) {
                await update(USERS_TABLE, { userId }, `SET ${sets.join(', ')}`, values);
                console.log(`Profile auto-filled from resume for ${userId}: ${sets.join(', ')}`);
            }
        } catch (autofillErr) {
            // Non-fatal: profile auto-fill must never break resume parsing.
            console.warn('Profile auto-fill skipped:', autofillErr.message);
        }
        console.info(`Successfully parsed resume ${resumeId}`);

        try {
            const allResumes = await getResumesByUserId(userId);
            if (allResumes.length === 1) {
                await setActiveResumeId(userId, resumeId);
                await update(RESUMES_TABLE, { resumeId }, 'SET isActive = :ia', { ':ia': true });
                console.info(`Auto-set resume ${resumeId} as active for user ${userId}`);
            }
        } catch (activationError) {
            // Parsing is already committed. A profile/index outage must not
            // mark the paid result FAILED and invite a redundant parse.
            console.warn('Resume auto-activation skipped:', activationError.name);
        }

    } catch (error) {
        console.error(`processAsync error for resumeId=${resumeId}:`, error.message);
        const failed = await deadline.finalize(() => updateResumeParsingResult(resumeId, 'FAILED', null, error.message, userId, parseAttemptId, source));
        if (!failed.success) throw failed.error || error;
    }
}

/**
 * Helper to invoke Claude 3 / Nemotron via Bedrock for resume parsing.
 */
async function invokeBedrockParser(text) {
    const prompt = `You are an AI resume parser. Extract the following information from the resume text into a strictly valid JSON object:
    {
      "name": "Full Name",
      "contact": { "email": "", "phone": "", "location": "" },
      "skills": ["skill1", "skill2"],
      "workExperience": [{ "company": "", "role": "", "duration": "", "highlights": [""] }],
      "projects": [{ "name": "", "technologies": [""], "description": "" }],
      "education": [{ "institution": "", "degree": "", "year": "" }]
    }
    Return ONLY strictly valid JSON. Do not return markdown formatted blocks (\`\`\`json).

    Resume Text:
    ${text.substring(0, 50000)}`;

    const body = {
        messages: [{ role: "user", content: [{ text: prompt }] }],
        max_tokens: 4000,
        temperature: 0.1
    };

    const response = await invokeModel(process.env.BEDROCK_MODEL_ID, body);

    let rawText = '';
    if (response.content && response.content[0] && response.content[0].text) {
        rawText = response.content[0].text;
    } else if (response.choices && response.choices[0]) {
        rawText = response.choices[0].message?.content || response.choices[0].text || '';
    } else {
        rawText = JSON.stringify(response);
    }

    try {
        return JSON.parse(rawText.trim());
    } catch (e) {
        console.info("JSON parse failed, attempting manual clean:", rawText.substring(0, 50));
        const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    }
}

const processResumeRequest = exports.handler;
exports.handler = (event, context) => require('../../lib/deadline').withDeadline(context,
    () => processResumeRequest(event, context), {
        maxMs: event.isAsyncWorker ? 120000 : 25000,
        userId: event.isAsyncWorker ? event.userId : event.requestContext?.authorizer?.uid,
        action: 'resumeParse'
    });
