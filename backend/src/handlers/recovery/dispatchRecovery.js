// One lightweight SQS consumer routes delayed work to isolated worker roles.
// Async Lambda delivery retries failures and retains exhausted events in DLQs.
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const deadline = require('../../lib/deadline');
const work = require('../../lib/eventWork');
const lambda = new LambdaClient({ maxAttempts: 1 });
const targets = {
  analysis: 'ANALYSIS_TARGET', deletion: 'DELETION_TARGET', dispatch: 'DISPATCH_TARGET',
  feedback: 'FEEDBACK_TARGET', resume: 'RESUME_TARGET', turn: 'TURN_TARGET'
};

exports.handler = (event, context) => deadline.withDeadline(context, async () => {
  if (!Array.isArray(event.Records)) throw new Error('Expected recovery queue records');
  const batchItemFailures = [];
  for (const record of event.Records) {
    try {
      if (record.eventSource !== 'aws:sqs') throw new Error('Unsupported recovery source');
      const task = JSON.parse(record.body);
      const target = Object.hasOwn(targets, task.worker) && process.env[targets[task.worker]];
      if (!target || task.version !== 1 || !Number.isFinite(task.dueAt)) throw new Error('Invalid recovery route');
      if (task.dueAt > Date.now()) {
        await work.enqueue(task, task.dueAt);
      } else {
        const result = await deadline.sendBounded(lambda, new InvokeCommand({
          FunctionName: target, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(task))
        }));
        if (result.StatusCode !== 202) throw new Error('Recovery worker did not accept delivery');
      }
    } catch (error) {
      require('../../lib/logger').safeConsole.warn('Recovery dispatch failed', { name: error.name });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}, { maxMs: 25000 });
