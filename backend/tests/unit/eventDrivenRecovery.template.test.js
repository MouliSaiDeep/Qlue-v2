const fs = require('node:fs');
const path = require('node:path');
const parse = require('../../../audit/read-cfn.cjs');
const template = parse(fs.readFileSync(path.join(__dirname, '../../template.yaml'), 'utf8'));
const resources = template.Resources;
const baseline = require('../fixtures/recovery-template-baseline.json');
const functions = Object.keys(baseline.functions);

test('all six polling schedules are removed, preserving every existing environment value and policy', () => {
  expect(template.Globals.Function.Environment).toMatchObject(baseline.globals);
  for (const id of functions) {
    const properties = resources[id].Properties;
    expect(Object.values(properties.Events || {}).some(event => event.Type === 'Schedule')).toBe(false);
    expect(properties.Environment.Variables).toMatchObject(baseline.functions[id].environment?.Variables || {});
    expect(properties.Policies).toEqual(expect.arrayContaining(baseline.functions[id].policies));
  }
});

test('ten interview sessions belong to each user, with separate user and system provider guards',()=>{
  const env=template.Globals.Function.Environment.Variables;
  expect(env.QUOTA_FREE_INTERVIEWS).toBe('10');
  expect(env.USER_PAID_ATTEMPT_LIMIT).toEqual({Ref:'UserPaidAttemptDailyLimit'});
  expect(template.Parameters.UserPaidAttemptDailyLimit.Default).toBe(500);
  expect(env.PAID_ATTEMPT_LIMIT).toEqual({Ref:'PaidAttemptDailyLimit'});
});

test('streams include old/new images and filter actual state fields without adding a competing interview consumer', () => {
  for (const id of ['AnalysisJobsTable', 'DeletionJobsTable', 'SessionsTable', 'ResumesTable', 'FeedbackTable']) {
    expect(resources[id].Properties.StreamSpecification.StreamViewType).toBe('NEW_AND_OLD_IMAGES');
  }
  const consumers = Object.entries(resources).flatMap(([id, resource]) =>
    Object.values(resource.Properties?.Events || {}).filter(event => event.Type === 'SQS' &&
      event.Properties.Queue['Fn::GetAtt'][0] === 'AsyncInterviewQueue').map(() => id));
  expect(consumers).toEqual(['AsyncInterviewWorkerFunction']);
  expect(resources.DispatchFeedbackJobsFunction.Properties.Events.StreamTrigger.Properties.Stream)
    .toEqual({ 'Fn::GetAtt': ['SessionsTable', 'StreamArn'] });
  expect(resources.RecoverTurnsFunction.Properties.Events).toBeUndefined();
  expect(resources.RecoveryDispatcherFunction.Properties.Events.QueueTrigger.Properties.Queue)
    .toEqual({ 'Fn::GetAtt': ['RecoveryDelayQueue', 'Arn'] });
});

test('every recovery stream has bounded retries, a DLQ, partial failures, and stream-read permissions', () => {
  for (const id of functions) {
    const properties = resources[id].Properties;
    const stream = properties.Events?.StreamTrigger?.Properties;
    if (!stream) continue;
    expect(stream.StartingPosition).toBe('TRIM_HORIZON');
    expect(stream.BatchSize).toBe(10);
    expect(stream.BisectBatchOnFunctionError).toBe(true);
    expect(stream.MaximumRetryAttempts).toBe(3);
    expect(stream.MaximumRecordAgeInSeconds).toBe(3600);
    expect(stream.FunctionResponseTypes).toContain('ReportBatchItemFailures');
    const dlq = stream.DestinationConfig.OnFailure.Destination['Fn::GetAtt'][0];
    expect(resources[dlq].Type).toBe('AWS::SQS::Queue');
    const statements = properties.Policies.flatMap(policy => policy.Statement || []);
    const read = statements.find(statement => JSON.stringify(statement.Resource) === JSON.stringify(stream.Stream));
    expect(read.Action).toEqual(expect.arrayContaining([
      'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:DescribeStream'
    ]));
    expect(statements).toContainEqual({Effect:'Allow',Action:['dynamodb:ListStreams'],Resource:'*'});
    for (const filter of stream.FilterCriteria.Filters) expect(() => JSON.parse(filter.Pattern)).not.toThrow();
  }
});

test('one shared delay consumer and async worker destinations retain failures', () => {
  const dispatcher = resources.RecoveryDispatcherFunction.Properties;
  const event = dispatcher.Events.QueueTrigger.Properties;
  const queue = resources.RecoveryDelayQueue.Properties;
  expect(queue.VisibilityTimeout).toBeGreaterThanOrEqual(6 * dispatcher.Timeout);
  expect(queue.RedrivePolicy.maxReceiveCount).toBe(5);
  expect(event.FunctionResponseTypes).toEqual(['ReportBatchItemFailures']);
  for (const id of functions) {
    const properties = resources[id].Properties;
    expect(Object.values(properties.Events || {}).filter(event => event.Type === 'SQS')).toHaveLength(0);
    expect(properties.Environment.Variables.RECOVERY_QUEUE_URL).toEqual({Ref:'RecoveryDelayQueue'});
    expect(properties.EventInvokeConfig).toMatchObject({ MaximumRetryAttempts:2, MaximumEventAgeInSeconds:3600,
      DestinationConfig:{OnFailure:{Type:'SQS',Destination:expect.any(Object)}} });
    expect(dispatcher.Policies).toContainEqual({LambdaInvokePolicy:{FunctionName:{Ref:id}}});
  }
});

test('the existing migration tool pauses event mappings after schedules are removed', () => {
  const {pausedTemplate} = require('../../../audit/prepare-paused-migration.cjs');
  const paused = pausedTemplate(template);
  expect(paused.template.Resources.PaidOpsSwitch.Properties.Value).toBe('all');
  for (const id of functions) {
    for (const event of Object.values(paused.template.Resources[id].Properties.Events || {})) {
      expect(event.Properties.Enabled).toBe(false);
    }
  }
  expect(resources.RecoveryDispatcherFunction.Properties.Events.QueueTrigger.Properties.Enabled).toBeUndefined();
  expect(paused.template.Resources.RecoveryDispatcherFunction.Properties.Events.QueueTrigger.Properties.Enabled).toBe(false);
});
