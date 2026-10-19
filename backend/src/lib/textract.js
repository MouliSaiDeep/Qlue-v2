const {
    TextractClient,
    StartDocumentTextDetectionCommand,
    GetDocumentTextDetectionCommand
} = require("@aws-sdk/client-textract");
const { NodeHttpHandler } = require("@smithy/node-http-handler");

const textract = new TextractClient({
    region: process.env.AWS_REGION || 'us-east-1',
    // Paid starts are retried by durable application jobs, so every attempt
    // passes through the stop switch and global provider budget.
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        requestTimeout: 30000
    })
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function guardedSend(command) {
    const operation = command.constructor.name;
    if (operation === 'StartDocumentAnalysisCommand' || operation === 'StartDocumentTextDetectionCommand') {
        await require('./paidWork').beforePaidCall(operation === 'StartDocumentAnalysisCommand' ? 'resumeParse' : 'jdAnalysis');
    }
    return require('./deadline').sendBounded(textract, command);
}

/**
 * Extract plain text from a PDF (or image) stored in S3 using Textract's
 * asynchronous text-detection API, polling until the job finishes.
 *
 * Used for job-description PDFs — lighter than the TABLES/FORMS analysis the
 * resume pipeline runs, since a JD only needs raw text. Bounded polling keeps
 * it inside the caller Lambda's timeout; a typical 1-2 page JD finishes in a
 * few seconds.
 *
 * @param {string} bucket S3 bucket name
 * @param {string} key    S3 object key
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=18] poll attempts (×1.5s ≈ 27s ceiling)
 * @returns {Promise<string>} the extracted text (LINE blocks joined by \n)
 */
async function extractTextFromPdf(bucket, key, opts = {}) {
    const maxAttempts = opts.maxAttempts || 18;
    await require('./paidWork').assertRuntimeEnabled(require('./deadline').current()?.action || 'jdAnalysis');
    const pdf = require('./pdf');
    const validated = await pdf.assertValidS3Pdf(require('./s3'), bucket, key, {
        versionId: opts.versionId,
        maxBytes: opts.maxBytes || pdf.MAX_JD_PDF_BYTES,
        maxPages: opts.maxPages || pdf.MAX_JD_PDF_PAGES
    });

    const start = await guardedSend(new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key, Version: validated.versionId } },
        ...(opts.clientRequestToken ? { ClientRequestToken: opts.clientRequestToken } : {})
    }));
    const jobId = start.JobId;

    let status = 'IN_PROGRESS';
    let completed;
    let attempts = 0;
    while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
        await sleep(1500);
        attempts++;
        const res = await guardedSend(new GetDocumentTextDetectionCommand({ JobId: jobId }));
        status = res.JobStatus;
        if (status === 'SUCCEEDED') completed = res;
    }

    if (status !== 'SUCCEEDED') {
        throw new Error(`Textract text detection did not succeed (status: ${status})`);
    }

    // Page through all result blocks and collect LINE text.
    let nextToken;
    let text = '';
    do {
        const page = completed || await guardedSend(new GetDocumentTextDetectionCommand({
            JobId: jobId,
            NextToken: nextToken
        }));
        completed = undefined;
        text += (page.Blocks || [])
            .filter((b) => b.BlockType === 'LINE')
            .map((b) => b.Text)
            .join('\n') + '\n';
        nextToken = page.NextToken;
    } while (nextToken);

    return text.trim();
}

module.exports = textract;
module.exports.extractTextFromPdf = extractTextFromPdf;
module.exports.guardedSend = guardedSend;
