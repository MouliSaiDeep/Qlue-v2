/**
 * SNS Trigger handler to start the feedback generation pipeline.
 */
const ddb = require('../../lib/dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TRANSCRIPT_TABLE = process.env.TRANSCRIPTS_TABLE || 'qlue-transcripts';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';

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

      // Fetch interim scores accumulated during the live session so the
      // analysis lambda can weigh them into the final report. (This was
      // always expected by the feedback pipeline tests but never wired up.)
      let accumulatedScores = {};
      try {
        const sessionResult = await ddb.get(SESSIONS_TABLE, { sessionId });
        if (sessionResult.success && sessionResult.data?.accumulatedScores) {
          accumulatedScores = sessionResult.data.accumulatedScores;
        }
      } catch (scoreErr) {
        console.warn(`Could not fetch accumulated scores for ${sessionId}:`, scoreErr.message);
      }

      // 3. Invoke analyzeTranscript asynchronously
      const payload = {
        sessionId,
        userId,
        moduleType,
        transcript: fullTranscript,
        accumulatedScores,
        contextRef,
        metadata: {
          turnCount: transcriptResult.data.length,
          startTime: transcriptResult.data[0].timestamp,
          endTime: transcriptResult.data[transcriptResult.data.length - 1].timestamp
        }
      };

      console.info(`Triggering analysis for session ${sessionId}`);
      const command = new InvokeCommand({
        FunctionName: process.env.ANALYZE_TRANSCRIPT_LAMBDA, // read lazily for configurability/testability
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
