const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { promisify } = require('node:util'), execFile = promisify(require('node:child_process').execFile);
const { SQSClient, GetQueueAttributesCommand } = require('../backend/node_modules/@aws-sdk/client-sqs');
const dir = path.resolve(__dirname, '../tmp/deploy-otp-2026-10-18');
const sqs = new SQSClient({ region: 'us-east-1', maxAttempts: 2 });
(async () => {
  const { stdout } = await execFile('C:/Program Files/Amazon/AWSCLIV2/aws.exe', ['cloudformation', 'list-stack-resources', '--stack-name', 'qlue-dev', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], { timeout: 30000 });
  const resources = JSON.parse(stdout).StackResourceSummaries;
  const ids = ['RecoveryDelayQueue', 'RecoveryDispatchDLQ', 'AnalysisWorkerDLQ', 'DeletionWorkerDLQ', 'FeedbackDLQ', 'ResumeRecoveryDLQ', 'TurnRecoveryDLQ'];
  const queues = await Promise.all(ids.map(async id => {
    const url = resources.find(r => r.LogicalResourceId === id).PhysicalResourceId;
    const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'] }));
    assert(Object.values(Attributes).every(x => Number(x) === 0), id + ' has outstanding messages');
    return { id, counts: Attributes };
  }));
  const logs = JSON.parse(fs.readFileSync(path.join(dir, 'router-probe-logs.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert(!logs.some(line => /Recovery dispatch failed|Task timed out|Unhandled|ERROR/.test(line)));
  const acceptedInvocations = logs.filter(line => line.includes('"metric":"InvokeCommand"')).length;
  assert(acceptedInvocations >= 6);
  const result = { verifiedAt: new Date().toISOString(), routerForwardsWithoutErrors: acceptedInvocations, sharedQueueDrained: true, deadLetterQueuesEmpty: true, queues };
  fs.writeFileSync(path.join(dir, 'queue-drain-verification.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => sqs.destroy());
