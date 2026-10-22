const diagnostics=require('../../lib/logger').safeConsole;
/**
 * SNS Trigger handler to start the feedback generation pipeline.
 */
const ddb = require('../../lib/dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TRANSCRIPT_TABLE = process.env.TRANSCRIPTS_TABLE || 'qlue-transcripts';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

exports.handler = async (event) => {
  // A malformed or incomplete notification is non-retryable and is skipped, but
  // a transient failure (failed transcript READ, failed downstream invoke) is
  // remembered and rethrown after the loop so SNS/Lambda retries and, once
  // exhausted, the DLQ captures it — feedback is never silently lost. (Finding 9.)
  let retryableError = null;

  for (const record of event.Records) {
    let snsMessage;
    try {
      snsMessage = JSON.parse(record.Sns.Message);
    } catch (parseErr) {
      diagnostics.error('Skipping unparseable SNS record (non-retryable):', parseErr.name);
      continue;
    }

    const { sessionId, userId, moduleType, contextRef } = snsMessage;
    if (!sessionId || !userId || !moduleType) {
      diagnostics.error('Missing required fields in SNS message; skipping (non-retryable)');
      continue;
    }

    try {
      const live = await require('../../lib/feedbackAttempt').currentAttempt(snsMessage);
      if (!live) continue;
      // 1. Query all Transcript records for the session
      diagnostics.info(`Fetching transcripts for session: ${sessionId}`);
      const transcriptResult={success:true,data:[]};let key;
      do {
        const page=await ddb.query(TRANSCRIPT_TABLE,'sessionId = :sid',{values:{':sid':sessionId},index:'GSI_SessionIdTurnIndex',scanIndexForward:true,exclusiveStartKey:key});
        if(!page.success) throw new Error('Transcript query failed');
        transcriptResult.data.push(...(page.data||[]));key=page.lastEvaluatedKey;
      }while(key);
      transcriptResult.data.sort(require('../../models/transcript').compareTranscripts);
      // An index may lag the atomic turn commit. Retry instead of permanently
      // acknowledging an incomplete conversation.
      const selected=require('../../lib/feedbackTranscript').select(live,transcriptResult.data);
      // A FAILED read is NOT "no transcripts" — swallowing it as empty loses the
      // feedback forever. Throw so the pipeline retries and, after exhaustion,
      // the DLQ surfaces it. A genuinely empty (but successful) query is a
      // completed-but-answerless session and is skipped without error.
      if (!transcriptResult.success) {
        throw new Error(`Transcript query failed for session ${sessionId}: ${transcriptResult.error?.message || 'unknown error'}`);
      }
      if (!transcriptResult.data || transcriptResult.data.length === 0) {
        diagnostics.warn(`No transcripts found for session ${sessionId}. Nothing to analyze; skipping.`);
        if (!live.discarded) throw new Error('Transcript index has not caught up');
        continue;
      }

      if(!selected.answers.length) continue;

      // 3. Invoke analyzeTranscript asynchronously
      const payload = {
        sessionId,
        attemptId: snsMessage.attemptId,
        userId,
        moduleType,
        contextRef,
        assessmentContext:require('../../lib/feedbackTranscript').assessmentContext(live),
        acceptedAnswers:selected.answers,
        answerPairs:require('../../lib/feedbackAssessment').pairs(selected),
        transcriptAdmission:selected.legacy?'LEGACY_FILTERED':'ACCEPTED_IDS',
        ...(snsMessage.retryReportId?{retryReportId:snsMessage.retryReportId}:{}),
        metadata: {
          turnCount: transcriptResult.data.length,
          startTime: transcriptResult.data[0].timestamp,
          endTime: transcriptResult.data[transcriptResult.data.length - 1].timestamp
        }
      };
      if(Buffer.byteLength(JSON.stringify(payload))>240000) {
        delete payload.answerPairs;
        payload.assessmentInputLimitExceeded=true;
      }

      diagnostics.info(`Triggering analysis for session ${sessionId}`);
      const command = new InvokeCommand({
        FunctionName: process.env.ANALYZE_TRANSCRIPT_LAMBDA, // read lazily for configurability/testability
        InvocationType: 'Event', // Async
        Payload: Buffer.from(JSON.stringify(payload))
      });

      await require('../../lib/deadline').sendBounded(lambdaClient,command);
      diagnostics.info(`Feedback pipeline started for session ${sessionId}`);

    } catch (error) {
      // Transient/downstream failure: remember it and keep processing the rest
      // of the batch, then rethrow after the loop so the delivery is retried.
      diagnostics.error(`Retryable failure in feedback trigger for session ${sessionId}:`, error.name);
      retryableError = error;
    }
  }

  if (retryableError) {
    throw retryableError;
  }

  return { success: true };
};
