// Streams identify durable work; delayed SQS messages revisit only that item.
// Queue payloads contain keys, never resumes, transcripts, or request bodies.
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const deadline = require('./deadline');
const { AsyncLocalStorage } = require('node:async_hooks');
const routing = new AsyncLocalStorage();
const sqs = new SQSClient({ maxAttempts: 2 });

async function read(table, key) {
  return (await deadline.sendBounded(require('./dynamodb').docClient,
    new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item;
}

async function enqueue(task, dueAt = Date.now(), queue = process.env.RECOVERY_QUEUE_URL) {
  if (!queue) throw new Error('Recovery queue is not configured');
  if (!Number.isFinite(dueAt)) throw new Error('Invalid recovery deadline');
  await deadline.sendBounded(sqs, new SendMessageCommand({
    QueueUrl: queue,
    DelaySeconds: Math.min(900, Math.max(0, Math.ceil((dueAt - Date.now()) / 1000))),
    MessageBody: JSON.stringify({ worker: routing.getStore(), ...task, version: 1, dueAt })
  }));
}

function changed(next, previous, fields) {
  return !previous || fields.some(field => JSON.stringify(next[field]) !== JSON.stringify(previous[field]));
}

function timestamp(value, fallback = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function handler({ worker, onStream, process, maxMs = 55000, direct }) {
  return (event = {}, context) => routing.run(worker, () => deadline.withDeadline(context, async () => {
    if (!Array.isArray(event.Records)) {
      // No implicit scan fallback: old scheduled events must not silently poll.
      if (direct) {
        try {
          if (event.version !== undefined && (event.version !== 1 || event.worker !== worker || !Number.isFinite(event.dueAt))) {
            throw new Error('Invalid recovery message');
          }
          if (event.dueAt > Date.now()) return enqueue(event, event.dueAt);
          return await direct(event);
        } catch (error) {
          if (error.code === 'ACCOUNT_DELETING' || error.name === 'ConditionalCheckFailedException') return;
          throw error;
        }
      }
      throw new Error('Expected a stream or recovery queue event');
    }
    const batchItemFailures = [];
    for (const record of event.Records) {
      const stream = record.eventSource === 'aws:dynamodb';
      const identifier = stream ? record.dynamodb?.SequenceNumber : record.messageId;
      try {
        if (deadline.remaining() < 5000) throw new Error('Recovery batch deadline exhausted');
        if (stream) {
          if (record.eventName === 'REMOVE' || !record.dynamodb?.NewImage) continue;
          await onStream(unmarshall(record.dynamodb.NewImage),
            record.dynamodb.OldImage ? unmarshall(record.dynamodb.OldImage) : undefined, record);
        } else if (record.eventSource === 'aws:sqs') {
          const task = JSON.parse(record.body);
          if (task.version !== 1 || !Number.isFinite(task.dueAt)) throw new Error('Invalid recovery message');
          // Carry absolute deadlines through SQS's 15-minute maximum delay.
          if (task.dueAt > Date.now()) await enqueue(task, task.dueAt);
          else await process(task);
        } else {
          throw new Error('Unsupported recovery event source');
        }
      } catch (error) {
        if (error.code === 'ACCOUNT_DELETING' || error.name === 'ConditionalCheckFailedException') continue;
        require('./logger').safeConsole.warn('Recovery record failed', { name: error.name });
        if (!identifier) throw error;
        batchItemFailures.push({ itemIdentifier: identifier });
        // A stream checkpoint starts at the first failed sequence number.
        if (stream) break;
      }
    }
    return { batchItemFailures };
  }, { maxMs }));
}

module.exports = { read, enqueue, changed, timestamp, handler };
