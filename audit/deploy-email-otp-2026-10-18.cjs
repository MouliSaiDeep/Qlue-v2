// Controlled, data-preserving update of the existing qlue-dev stack.
// Run individual phases after reviewing their evidence; never purges a queue.
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { DynamoDBClient } = require('../backend/node_modules/@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('../backend/node_modules/@aws-sdk/lib-dynamodb');
const dir = path.resolve(__dirname, '../tmp/deploy-otp-2026-10-18');
const awsPath = 'C:/Program Files/Amazon/AWSCLIV2/aws.exe';
const save = (name, value) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8').replace(/^\uFEFF/, ''));
async function aws(args) {
  const { stdout } = await execFile(awsPath, [...args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '20'],
    { timeout: 35000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_EC2_METADATA_DISABLED: 'true' } });
  return stdout.trim() ? JSON.parse(stdout) : {};
}
async function resources() { return (await aws(['cloudformation', 'list-stack-resources', '--stack-name', 'qlue-dev'])).StackResourceSummaries; }
async function snapshot() {
  if (fs.existsSync(path.join(dir, 'maintenance.json'))) throw Error('Preserve existing maintenance snapshot');
  const rs = await resources();
  const rules = await Promise.all(rs.filter(r => r.ResourceType === 'AWS::Events::Rule').map(async r => ({ name: r.PhysicalResourceId, state: (await aws(['events', 'describe-rule', '--name', r.PhysicalResourceId])).State })));
  const mappings = await Promise.all(rs.filter(r => r.ResourceType === 'AWS::Lambda::EventSourceMapping').map(async r => ({ logical: r.LogicalResourceId, uuid: r.PhysicalResourceId, state: (await aws(['lambda', 'get-event-source-mapping', '--uuid', r.PhysicalResourceId])).State })));
  const switchName = rs.find(r => r.LogicalResourceId === 'PaidOpsSwitch').PhysicalResourceId;
  const previousSwitch = (await aws(['ssm', 'get-parameter', '--name', switchName])).Parameter.Value;
  let template = read('live-processed').TemplateBody;
  if (typeof template === 'string') template = JSON.parse(template);
  const drainSeconds = Math.max(...Object.values(template.Resources).filter(r => r.Type === 'AWS::Lambda::Function').map(r => r.Properties.Timeout || 3)) + 20;
  save('maintenance', { stack: 'qlue-dev', switchName, previousSwitch, rules, mappings, drainSeconds, capturedAt: new Date().toISOString() });
  console.log(JSON.stringify({ rules: rules.length, mappings: mappings.length, previousSwitch, drainSeconds }));
}
async function pause() {
  const x = read('maintenance');
  if (x.stack !== 'qlue-dev') throw Error('Wrong target');
  await aws(['ssm', 'put-parameter', '--name', x.switchName, '--type', 'String', '--value', 'all', '--overwrite']);
  for (const r of x.rules) if (r.state === 'ENABLED') await aws(['events', 'disable-rule', '--name', r.name]);
  // Keep the existing profile consumer running until in-flight feedback writes
  // have drained, so changing the stream descriptor cannot discard that work.
  for (const m of x.mappings) if (m.state === 'Enabled' && m.logical !== 'UpdateGlobalProfileFunctionFeedbackStream') await aws(['lambda', 'update-event-source-mapping', '--uuid', m.uuid, '--no-enabled']);
  x.drainNotBefore = new Date(Date.now() + x.drainSeconds * 1000).toISOString();
  save('maintenance', x);
  console.log(JSON.stringify({ paused: true, drainNotBefore: x.drainNotBefore }));
}
async function inventory() {
  const x = read('maintenance');
  if (!x.drainNotBefore || Date.now() < Date.parse(x.drainNotBefore)) throw Error('Drain must finish before reconciliation inventory');
  const rs = await resources();
  const profile = x.mappings.find(m => m.logical === 'UpdateGlobalProfileFunctionFeedbackStream');
  if (profile?.state === 'Enabled') {
    const mapping = await aws(['lambda', 'get-event-source-mapping', '--uuid', profile.uuid]);
    if (mapping.State !== 'Enabled' || !['OK', 'No records processed'].includes(mapping.LastProcessingResult)) throw Error('Existing feedback profile consumer is not healthy; inspect backlog before switching streams');
    const profileFunction = rs.find(r => r.LogicalResourceId === 'UpdateGlobalProfileFunction').PhysicalResourceId;
    const metrics = await aws(['cloudwatch', 'get-metric-statistics', '--namespace', 'AWS/Lambda', '--metric-name', 'IteratorAge', '--dimensions', `Name=FunctionName,Value=${profileFunction}`, '--start-time', new Date(Date.now() - 10 * 60000).toISOString(), '--end-time', new Date().toISOString(), '--period', '60', '--statistics', 'Maximum']);
    const recent = metrics.Datapoints.sort((a, b) => Date.parse(b.Timestamp) - Date.parse(a.Timestamp)).slice(0, 2);
    if (recent.some(p => p.Maximum > 10000)) throw Error('Profile stream has outstanding lag; inspect before changing its descriptor');
    save('profile-consumer-before-migration', { mappingState: mapping.State, processingResult: mapping.LastProcessingResult, iteratorAge: recent });
    await aws(['lambda', 'update-event-source-mapping', '--uuid', profile.uuid, '--no-enabled']);
  }
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1', maxAttempts: 2 }));
  const fields = {
    AnalysisJobsTable: ['jobId', 'status'],
    DeletionJobsTable: ['userId', 'status'],
    ResumesTable: ['resumeId', 'status', 'parseAttemptId'],
    FeedbackTable: ['feedbackId', 'notificationStatus'],
    SessionsTable: ['sessionId', 'userId', 'recoveryCursor', 'currentState', 'feedbackJob', 'feedbackDispatchPending', 'feedbackAttemptId', 'feedbackStatus', 'answerAudio', 'answerAudioClosed', 'answerAudioCleanupPending', 'jobId']
  };
  const tasks = [], counts = {};
  for (const [logical, names] of Object.entries(fields)) {
    const TableName = rs.find(r => r.LogicalResourceId === logical).PhysicalResourceId;
    let key, scanned = 0;
    do {
      const namesMap = Object.fromEntries(names.map((n, i) => ['#f' + i, n]));
      const page = await ddb.send(new ScanCommand({ TableName, ConsistentRead: true, Limit: 100, ExclusiveStartKey: key,
        ProjectionExpression: Object.keys(namesMap).join(','), ExpressionAttributeNames: namesMap }));
      scanned += page.ScannedCount || 0;
      for (const row of page.Items || []) {
        if (logical === 'AnalysisJobsTable' && ['PENDING', 'RUNNING'].includes(row.status)) tasks.push({ worker: 'analysis', jobId: row.jobId });
        if (logical === 'DeletionJobsTable' && row.status !== 'COMPLETE') tasks.push({ worker: 'deletion', userId: row.userId });
        if (logical === 'ResumesTable' && row.status === 'PARSING') tasks.push({ worker: 'resume', resumeId: row.resumeId, attemptId: row.parseAttemptId });
        if (logical === 'FeedbackTable' && ['PENDING', 'SENDING'].includes(row.notificationStatus)) tasks.push({ worker: 'feedback', kind: 'notification', feedbackId: row.feedbackId });
        if (logical === 'SessionsTable' && row.sessionId && row.userId && !row.recoveryCursor) {
          if (row.currentState === 'GENERATING_FEEDBACK' && row.feedbackJob?.status === 'PENDING') tasks.push({ worker: 'dispatch', sessionId: row.sessionId, attemptId: row.feedbackAttemptId });
          if (row.feedbackStatus === 'PENDING') tasks.push({ worker: 'feedback', kind: 'feedbackTimeout', sessionId: row.sessionId, attemptId: row.feedbackAttemptId });
          if (['INITIALIZING', 'PROCESSING_RESPONSE', 'LOADING_CONTEXT'].includes(row.currentState)) tasks.push({ worker: 'turn', sessionId: row.sessionId, jobId: row.jobId });
          if (row.answerAudio && (!row.answerAudioClosed || row.answerAudioCleanupPending)) tasks.push({ worker: 'feedback', kind: 'audioCleanup', sessionId: row.sessionId });
        }
      }
      key = page.LastEvaluatedKey;
    } while (key);
    counts[logical] = scanned;
  }
  // Store only identifiers and attempts, never scanned customer documents.
  save('reconciliation', { capturedAt: new Date().toISOString(), counts, tasks });
  console.log(JSON.stringify({ counts, targetedTasks: tasks.length, byWorker: tasks.reduce((a, t) => ({ ...a, [t.worker]: (a[t.worker] || 0) + 1 }), {}) }));
}
async function reconcile() {
  const rs = await resources(), queue = rs.find(r => r.LogicalResourceId === 'RecoveryDelayQueue').PhysicalResourceId;
  const x = read('reconciliation');
  const accepted = [];
  for (const [i, task] of x.tasks.entries()) {
    const result = await aws(['sqs', 'send-message', '--queue-url', queue, '--message-body', JSON.stringify({ ...task, version: 1, dueAt: Date.now() })]);
    accepted.push({ index: i, messageId: result.MessageId });
    save('reconciliation-accepted', accepted);
  }
  save('reconciliation-accepted', accepted);
  console.log(JSON.stringify({ accepted: accepted.length, queuesPurged: 0, customerRowsRewritten: 0 }));
}
async function prepareActive() {
  const x = read('maintenance');
  const stack = (await aws(['cloudformation', 'describe-stacks', '--stack-name', 'qlue-dev'])).Stacks[0];
  if (stack.StackStatus !== 'UPDATE_COMPLETE') throw Error('Paused deployment must finish first');
  const original = await aws(['cloudformation', 'get-template', '--stack-name', 'qlue-dev', '--template-stage', 'Original']);
  const template = typeof original.TemplateBody === 'string' ? require('./read-cfn.cjs')(original.TemplateBody) : original.TemplateBody;
  let mappings = 0;
  for (const resource of Object.values(template.Resources)) for (const event of Object.values(resource.Properties?.Events || {})) {
    if (['DynamoDB', 'SQS'].includes(event.Type)) { event.Properties.Enabled = true; mappings++; }
  }
  if (mappings !== 8) throw Error('Unexpected activation mapping count');
  template.Resources.PaidOpsSwitch.Properties.Value = x.previousSwitch;
  const file = path.join(dir, 'active-packaged-template.json');
  fs.writeFileSync(file, JSON.stringify(template, null, 2));
  // Reuse the exact reviewed S3 code/layer artifacts, without rebuilding them.
  const code = template.Resources.RegisterUserFunction.Properties.CodeUri;
  const bucket = typeof code === 'string' ? /^s3:\/\/([^/]+)\//.exec(code)?.[1] : code.Bucket;
  if (!bucket?.startsWith('aws-sam-cli-managed-default-')) throw Error('Unexpected artifact bucket');
  const key = 'qlue-dev/deploy-otp-2026-10-18-active-' + Date.now() + '.template';
  await aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', file, '--server-side-encryption', 'AES256']);
  const result = await aws(['cloudformation', 'create-change-set', '--stack-name', 'qlue-dev', '--change-set-name', 'qlue-otp-activate-' + Date.now(), '--change-set-type', 'UPDATE',
    '--template-url', `https://${bucket}.s3.us-east-1.amazonaws.com/${key}`, '--capabilities', 'CAPABILITY_IAM',
    '--parameters', JSON.stringify(stack.Parameters.map(p => ({ ParameterKey: p.ParameterKey, UsePreviousValue: true })))]);
  save('active-preparation', result);
  console.log(JSON.stringify({ changeSet: result.Id, mappings, restoreSwitch: x.previousSwitch }));
}
const phases = { snapshot, pause, inventory, reconcile, 'prepare-active': prepareActive };
(async () => { if (!phases[process.argv[2]]) throw Error('Use snapshot, pause, inventory, or reconcile'); await phases[process.argv[2]](); })()
  .catch(e => { console.error(e.message); process.exitCode = 1; });
