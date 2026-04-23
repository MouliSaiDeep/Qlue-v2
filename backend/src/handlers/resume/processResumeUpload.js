const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { query, update } = require('../../lib/dynamodb');
const textractClient = require('../../lib/textract');
const { invokeModel } = require('../../lib/bedrock');
const { 
    StartDocumentAnalysisCommand, 
    GetDocumentAnalysisCommand 
} = require("@aws-sdk/client-textract");
const { updateResumeParsingResult, getResumesByUserId, getResumeById } = require('../../models/resume');
const { setActiveResumeId } = require('../../models/user');
const { success, badRequest, notFound, internalError, unauthorized } = require('../../lib/response');

const lambdaClient = new LambdaClient({});
const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';
const BUCKET_NAME = process.env.RESUMES_BUCKET || 'qlue-resumes';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        await processAsync(event.resumeId, event.userId, event.s3Key);
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

        // 2. Update status to PARSING
        await updateResumeParsingResult(resumeId, 'PARSING');

        // 3. Trigger SELF asynchronously
        const workerPayload = {
            isAsyncWorker: true,
            resumeId: resumeId,
            userId: userId,
            s3Key: s3Key
        };

        const invokeCommand = new InvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            InvocationType: 'Event', // This makes it asynchronous
            Payload: JSON.stringify(workerPayload)
        });

        await lambdaClient.send(invokeCommand);
        console.info(`Asynchronous worker triggered for ${resumeId}`);

        return success({ 
            resumeId, 
            status: 'PARSING', 
            message: 'Resume received and parsing started.' 
        }, 202);

    } catch (error) {
        console.error('Process Resume Upload Error:', error);
        return internalError(error.message);
    }
};

/**
 * Runs Textract + Bedrock in the background.
 */
async function processAsync(resumeId, userId, s3Key) {
    try {
        // Reduced initial wait - S3 is strongly consistent now
        await sleep(500);
        
        // Start Textract Async Analysis
        const startCommand = new StartDocumentAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: BUCKET_NAME, Name: s3Key } },
            FeatureTypes: ['TABLES', 'FORMS']
        });
        const startRes = await textractClient.send(startCommand);
        const jobId = startRes.JobId;
        console.info(`Textract started for resumeId=${resumeId}, jobId=${jobId}`);

        let jobStatus = 'IN_PROGRESS';
        let attempts = 0;
        const maxAttempts = 100; // Increased attempts but decreased interval

        while (jobStatus === 'IN_PROGRESS' && attempts < maxAttempts) {
            // High-frequency polling (every 1.5s) for snappier experience for small PDFs
            await sleep(1500);
            attempts++;
            const getCommand = new GetDocumentAnalysisCommand({ JobId: jobId });
            const statusRes = await textractClient.send(getCommand);
            jobStatus = statusRes.JobStatus;
            
            // Log only every 5th attempt to keep logs clean
            if (attempts % 5 === 0) {
                console.info(`Textract status for ${resumeId}: ${jobStatus} (attempt ${attempts})`);
            }
        }

        if (jobStatus !== 'SUCCEEDED') {
            throw new Error(`Textract job did not succeed. Final status: ${jobStatus}`);
        }

        // Collect all text blocks
        let nextToken = null;
        let fullText = '';
        do {
            const pageRes = await textractClient.send(new GetDocumentAnalysisCommand({ 
                JobId: jobId, 
                NextToken: nextToken 
            }));
            fullText += (pageRes.Blocks || [])
                .filter(b => b.BlockType === 'LINE')
                .map(b => b.Text)
                .join('\n') + '\n';
            nextToken = pageRes.NextToken;
        } while (nextToken);

        // Validate extraction quality
        const wordCount = fullText.split(/\s+/).length;
        if (wordCount < 10) { // Adjusted threshold
            throw new Error('Insufficient text extracted from document.');
        }

        // Call Bedrock to structure the data
        const parsedData = await invokeBedrockParser(fullText);

        // Update final result in DynamoDB
        await updateResumeParsingResult(resumeId, 'PARSED', parsedData);
        console.info(`Successfully parsed resume ${resumeId}`);

        const allResumes = await getResumesByUserId(userId);
        if (allResumes.length === 1) {
            await setActiveResumeId(userId, resumeId);
            await update(RESUMES_TABLE, { resumeId }, 'SET isActive = :ia', { ':ia': true });
            console.info(`Auto-set resume ${resumeId} as active for user ${userId}`);
        }

    } catch (error) {
        console.error(`processAsync error for resumeId=${resumeId}:`, error.message);
        await updateResumeParsingResult(resumeId, 'FAILED', null, error.message);
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
        messages: [{ role: "user", content: prompt }],
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
