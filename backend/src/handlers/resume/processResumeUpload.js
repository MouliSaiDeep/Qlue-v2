const { query, update } = require('../../lib/dynamodb');
const textractClient = require('../../lib/textract');
const bedrockClient = require('../../lib/bedrock');
const { 
    StartDocumentAnalysisCommand, 
    GetDocumentAnalysisCommand 
} = require("@aws-sdk/client-textract");
const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { updateResumeParsingResult, getResumesByUserId, getResumeById } = require('../../models/resume');
const { setActiveResumeId } = require('../../models/user');
const { success, badRequest, notFound, internalError, unauthorized } = require('../../lib/response');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';
const BUCKET_NAME = process.env.RESUMES_BUCKET || 'qlue-resumes';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * AWS Lambda Handler: API Gateway REST endpoint
 */
exports.handler = async (event) => {
    let resumeRecord = null;
    let userId = null;

    try {
        if (!event.body) return badRequest('Missing request body');
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        const { resumeId } = body;
        
        if (!resumeId) return badRequest('resumeId is required');

        userId = event.requestContext?.authorizer?.uid;
        if (!userId) return unauthorized('Unauthorized access: Missing user ID');

        // 1. Find the database record matching this resumeId
        resumeRecord = await getResumeById(resumeId);

        if (!resumeRecord) {
            console.error('No matching resume record found for ID:', resumeId);
            return notFound('Resume not found');
        }
        
        if (resumeRecord.userId !== userId) {
            return unauthorized('User does not own this resume');
        }
        
        const s3Key = resumeRecord.s3Key;

        // 2. Update status to PARSING
        await updateResumeParsingResult(resumeId, 'PARSING');
        
        // 3. Start Textract Analysis
        const startCommand = new StartDocumentAnalysisCommand({
            DocumentLocation: { S3Object: { Bucket: BUCKET_NAME, Name: s3Key } },
            FeatureTypes: ['TABLES', 'KEY_VALUE_PAIRS']
        });
        const startRes = await textractClient.send(startCommand);
        const jobId = startRes.JobId;

        // 4. Wait for Textract completion
        let jobStatus = 'IN_PROGRESS';
        while (jobStatus === 'IN_PROGRESS') {
            await sleep(2000);
            const getCommand = new GetDocumentAnalysisCommand({ JobId: jobId });
            const statusRes = await textractClient.send(getCommand);
            jobStatus = statusRes.JobStatus;
            
            if (jobStatus === 'SUCCEEDED') {
                // Collect all text
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

                // 5. Validate extraction quality
                const wordCount = fullText.split(/\s+/).length;
                if (wordCount < 30) {
                    await updateResumeParsingResult(resumeId, 'FAILED', null, 'Insufficient text extracted from document.');
                    return badRequest('Insufficient text extracted from document.');
                }

                // 6. Call Bedrock to structure the data
                const parsedData = await invokeBedrockParser(fullText);

                // 7. Update final result
                await updateResumeParsingResult(resumeId, 'PARSED', parsedData);

                // 8. Auto-set as active if it's the first or only resume
                const allResumes = await getResumesByUserId(userId);
                if (allResumes.length === 1) {
                    await setActiveResumeId(userId, resumeId);
                    await update(RESUMES_TABLE, { resumeId }, 'SET isActive = :ia', { ':ia': true });
                }

                return success({ resumeId, status: 'PARSED', parsedData });

            } else if (jobStatus === 'FAILED') {
                throw new Error(`Textract Failed for job: ${jobId}`);
            }
        }

    } catch (error) {
        console.error('Process Resume Upload Error:', error);
        if (resumeRecord) {
            await updateResumeParsingResult(resumeRecord.resumeId, 'FAILED', null, error.message);
        }
        return internalError(error.message);
    }
};

/**
 * Helper to invoke Claude 3 via Bedrock for resume parsing
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

    const command = new InvokeModelCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4000,
            messages: [{ role: "user", content: prompt }]
        })
    });

    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const rawText = result.content[0].text;
    
    try {
        return JSON.parse(rawText.trim());
    } catch (e) {
        console.error("JSON parse failed, attempting manual clean:", rawText);
        const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    }
}
