/**
 * SNS Trigger handler to start the feedback generation pipeline.
 */
const ddb = require('../../lib/dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const TRANSCRIPT_TABLE = process.env.TRANSCRIPT_TABLE || 'Transcripts';
const ANALYZE_LAMBDA = process.env.ANALYZE_TRANSCRIPT_LAMBDA;

exports.handler = async (event) => {
  for (const record of event.Records) {
    try {
      const snsMessage = JSON.parse(record.Sns.Message);
      const { sessionId, userId, moduleType, contextRef } = snsMessage;

      if (!sessionId || !userId || !moduleType) {
        console.error('Missing required fields in SNS message:', snsMessage);
        continue;
      }

      // 1. Query all Transcript records for the session
      console.info(`Fetching transcripts for session: ${sessionId}`);
      const transcriptResult = await ddb.query(
        TRANSCRIPT_TABLE,
        'sessionId = :sid',
        {
          values: { ':sid': sessionId },
          index: 'GSI_SessionIdTurnIndex',
          scanIndexForward: true // Sort by turnIndex
        }
      );

      if (!transcriptResult.success || !transcriptResult.data || transcriptResult.data.length === 0) {
        console.warn(`No transcripts found for session ${sessionId}. Skipping analysis.`);
        continue;
      }

      // 2. Build complete transcript text
      const fullTranscript = transcriptResult.data
        .map(t => `${(t.speaker || 'UNKNOWN').toUpperCase()}: ${t.text}`)
        .join('\n\n');

      // 3. Invoke analyzeTranscript asynchronously
      const payload = {
        sessionId,
        userId,
        moduleType,
        transcript: fullTranscript,
        contextRef,
        metadata: {
          turnCount: transcriptResult.data.length,
          startTime: transcriptResult.data[0].timestamp,
          endTime: transcriptResult.data[transcriptResult.data.length - 1].timestamp
        }
      };

      console.info(`Triggering analysis for session ${sessionId}`);
      const command = new InvokeCommand({
        FunctionName: ANALYZE_LAMBDA,
        InvocationType: 'Event', // Async
        Payload: Buffer.from(JSON.stringify(payload))
      });

      await lambdaClient.send(command);
      console.info(`Feedback pipeline started for session ${sessionId}`);

    } catch (error) {
      console.error('Error processing SNS record:', error);
      // Don't throw to avoid SNS retries for a single bad record in a batch
    }
  }

  return { success: true };
};
