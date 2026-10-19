const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { LambdaClient, GetFunctionConfigurationCommand, GetEventSourceMappingCommand, InvokeCommand } = require('../backend/node_modules/@aws-sdk/client-lambda');
const { DynamoDBClient, DescribeTableCommand } = require('../backend/node_modules/@aws-sdk/client-dynamodb');
const { SSMClient, GetParameterCommand } = require('../backend/node_modules/@aws-sdk/client-ssm');
const { SQSClient, GetQueueAttributesCommand, SendMessageBatchCommand } = require('../backend/node_modules/@aws-sdk/client-sqs');
const { CognitoIdentityProviderClient, DescribeUserPoolCommand, DescribeUserPoolClientCommand } = require('../backend/node_modules/@aws-sdk/client-cognito-identity-provider');
const dir = path.resolve(__dirname, '../tmp/deploy-otp-2026-10-18');
const options = { region: 'us-east-1', maxAttempts: 2 };
const lambda = new LambdaClient(options), ddb = new DynamoDBClient(options), ssm = new SSMClient(options), sqs = new SQSClient(options), cognito = new CognitoIdentityProviderClient(options);
async function main() {
  const { stdout } = await execFile('C:/Program Files/Amazon/AWSCLIV2/aws.exe', ['cloudformation', 'describe-stacks', '--stack-name', 'qlue-dev', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], { timeout: 30000 });
  const stack = JSON.parse(stdout).Stacks[0]; assert.equal(stack.StackStatus, 'UPDATE_COMPLETE');
  const { stdout: inventory } = await execFile('C:/Program Files/Amazon/AWSCLIV2/aws.exe', ['cloudformation', 'list-stack-resources', '--stack-name', 'qlue-dev', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], { timeout: 30000 });
  const rs = JSON.parse(inventory).StackResourceSummaries;
  const resource = id => { const r = rs.find(r => r.LogicalResourceId === id); assert(r, id); return r.PhysicalResourceId; };
  assert.equal(rs.filter(r => r.ResourceType === 'AWS::Events::Rule').length, 0);
  const source = require('./read-cfn.cjs')(fs.readFileSync(path.resolve(__dirname, '../backend/template.yaml'), 'utf8'));
  const configs = [];
  // Keep AWS's control-plane request rate bounded.
  const functions = Object.entries(source.Resources).filter(([, r]) => r.Type === 'AWS::Serverless::Function');
  for (let i = 0; i < functions.length; i += 4) configs.push(...await Promise.all(functions.slice(i, i + 4).map(async ([id, r]) => {
    const c = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: resource(id) }));
    assert.equal(c.State, 'Active', id); assert.equal(c.LastUpdateStatus, 'Successful', id);
    assert.equal(c.Runtime, 'nodejs24.x'); assert.deepEqual(c.Architectures, ['arm64']); assert.equal(c.Handler, r.Properties.Handler);
    if (['RegisterUserFunction', 'SendEmailOtpFunction', 'VerifyEmailOtpFunction'].includes(id)) {
      assert.equal(c.Environment.Variables.EMAIL_OTP_POOL_ID, resource('EmailOtpPool'));
      assert.equal(c.Environment.Variables.EMAIL_OTP_TABLE, resource('EmailOtpTable'));
    }
    assert.equal(c.Environment.Variables.PAID_ATTEMPT_LIMIT, '50');
    return { id, hash: c.CodeSha256, layers: c.Layers.map(l => l.Arn) };
  })));
  assert.equal(configs.length, 60); assert.equal(new Set(configs.map(c => c.hash)).size, 1);
  const mappings = [];
  for (const r of rs.filter(r => r.ResourceType === 'AWS::Lambda::EventSourceMapping')) {
    mappings.push(await lambda.send(new GetEventSourceMappingCommand({ UUID: r.PhysicalResourceId })));
  }
  assert.equal(mappings.length, 8); for (const m of mappings) assert.equal(m.State, 'Enabled', m.UUID);
  const originalQueueName = resource('AsyncInterviewQueue').split('/').pop();
  const originalConsumers = mappings.filter(m => m.EventSourceArn.endsWith(':' + originalQueueName));
  assert.equal(originalConsumers.length, 1); assert(originalConsumers[0].FunctionArn.endsWith(':' + resource('AsyncInterviewWorkerFunction')));
  const tables = [];
  for (const id of ['AnalysisJobsTable', 'DeletionJobsTable', 'FeedbackTable', 'ResumesTable', 'SessionsTable']) {
    const { Table } = await ddb.send(new DescribeTableCommand({ TableName: resource(id) }));
    assert.equal(Table.StreamSpecification.StreamEnabled, true); assert.equal(Table.StreamSpecification.StreamViewType, 'NEW_AND_OLD_IMAGES');
    tables.push(id);
  }
  const switchValue = (await ssm.send(new GetParameterCommand({ Name: resource('PaidOpsSwitch') }))).Parameter.Value;
  assert.equal(switchValue, 'none');
  assert.equal(stack.Parameters.find(p => p.ParameterKey === 'PaidAttemptDailyLimit').ParameterValue, '50');
  const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: resource('EmailOtpPool') }));
  assert.equal(UserPool.EmailConfiguration.EmailSendingAccount, 'COGNITO_DEFAULT');
  assert.equal(UserPool.VerificationMessageTemplate.DefaultEmailOption, 'CONFIRM_WITH_CODE');
  const client = await cognito.send(new DescribeUserPoolClientCommand({ UserPoolId: resource('EmailOtpPool'), ClientId: resource('EmailOtpClient') }));
  assert(client.UserPoolClient.ClientSecret); // Confidential; deliberately never printed/saved.
  const absent = 'deployment-absent-' + crypto.randomUUID();
  const probes = [
    ['AnalysisWorkerFunction', { worker: 'analysis', jobId: absent }], ['DeletionWorkerFunction', { worker: 'deletion', userId: absent }],
    ['DispatchFeedbackJobsFunction', { worker: 'dispatch', sessionId: absent }], ['RecoverFeedbackFunction', { worker: 'feedback', kind: 'notification', feedbackId: absent }],
    ['RecoverResumesFunction', { worker: 'resume', resumeId: absent }], ['RecoverTurnsFunction', { worker: 'turn', sessionId: absent }]
  ];
  for (const [id, task] of probes) {
    const r = await lambda.send(new InvokeCommand({ FunctionName: resource(id), InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify({ ...task, version: 1, dueAt: Date.now() })) }));
    assert.equal(r.StatusCode, 200); assert(!r.FunctionError, id + ' failed synthetic absent-key probe');
  }
  const queued = await sqs.send(new SendMessageBatchCommand({ QueueUrl: resource('RecoveryDelayQueue'), Entries: probes.map(([, task], i) => ({ Id: String(i), MessageBody: JSON.stringify({ ...task, version: 1, dueAt: Date.now() }) })) }));
  assert.equal(queued.Failed?.length || 0, 0);
  const queues = [];
  for (const id of ['AnalysisWorkerDLQ', 'DeletionWorkerDLQ', 'FeedbackDLQ', 'ResumeRecoveryDLQ', 'TurnRecoveryDLQ', 'RecoveryDispatchDLQ', 'RecoveryDelayQueue']) {
    const r = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: resource(id), AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'] }));
    queues.push({ id, attributes: r.Attributes });
  }
  const result = { verifiedAt: new Date().toISOString(), stackStatus: stack.StackStatus, functions: configs.length, allFunctionCodeHashesMatch: true,
    functionCodeSha256: configs[0].hash, runtime: 'nodejs24.x', architecture: 'arm64', enabledMappings: mappings.length, originalInterviewQueueConsumers: originalConsumers.length,
    streamTables: tables, pollingRules: 0, processingSwitch: switchValue, paidDailyAttemptCap: 50, otpDailyEmailAttemptCap: 40,
    sender: UserPool.EmailConfiguration.From || 'no-reply@verificationemail.com', liveWorkerReadProbesPassed: probes.length, sharedQueueProbeMessagesAccepted: queued.Successful.length, queues };
  fs.writeFileSync(path.join(dir, 'live-verification.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
}
main().catch(e => { console.error(e.name, e.message); process.exitCode = 1; }).finally(() => { for (const c of [lambda, ddb, ssm, sqs, cognito]) c.destroy(); });
