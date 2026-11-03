const { inventory } = require('../../../audit/backend-live-baseline.cjs');
test('live inventory exposes configuration fingerprints but no environment values or provider invocations', async () => {
  const calls = [];
  const read = async args => {
    calls.push(args);
    if (args[1] === 'describe-stacks') return { Stacks: [{ StackStatus: 'UPDATE_COMPLETE' }] };
    if (args[1] === 'list-stack-resources') return { StackResourceSummaries: [
      { LogicalResourceId: 'StoreFeedbackReportFunction', PhysicalResourceId: 'f' },
      { LogicalResourceId: 'SttSessionsTable', PhysicalResourceId: 'stt' }] };
    if (args[0] === 'lambda') return { Runtime: 'nodejs24.x', CodeSha256: 'code',
      Environment: { Variables: { SECRET: 'private-value' } }, Role: 'role' };
    if (args[0] === 'dynamodb') return { Item: { rolloutEnabled: { BOOL: true }, globalStreamSlots: { N: '4' } } };
    return { Quotas: [{ QuotaName: 'Concurrent streaming requests', Value: 25 }] };
  };
  const result = await inventory({ read });
  expect(JSON.stringify(result)).not.toContain('private-value');
  expect(result.functions[0].configurationSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result).toMatchObject({ providerCalls: 0, resourceChanges: 0, control: { globalStreamSlots: '4' } });
  expect(calls.every(args => ['describe-stacks', 'list-stack-resources', 'get-function-configuration', 'get-item', 'list-service-quotas'].includes(args[1]))).toBe(true);
});
test('missing quota permissions remain unknown, never reported as sufficient capacity', async () => {
  const result = await inventory({ read: async args => {
    if (args[1] === 'describe-stacks') return { Stacks: [{ StackStatus: 'UPDATE_COMPLETE' }] };
    if (args[1] === 'list-stack-resources') return { StackResourceSummaries: [] };
    throw Error('not permitted');
  } });
  expect(result.transcribeStreamingQuotas).toBeNull(); expect(result.control).toBeNull();
});
