const { metricDocument, recordMetrics } = require('../../../src/lib/metrics');
test('application telemetry permits only bounded names and numeric observations', () => {
  const result = metricDocument('Model', { ProviderAttempt: 1, InputTokens: 120,
    OutputTokens: undefined, transcript: 'private', userId: 'private', ProviderLatencyMs: NaN }, 123);
  expect(result).toEqual({ _aws: { Timestamp: 123, CloudWatchMetrics: [{ Namespace: 'Qlue/Application',
    Dimensions: [['Operation']], Metrics: [{ Name: 'ProviderAttempt', Unit: 'Count' }, { Name: 'InputTokens', Unit: 'Count' }] }] },
    Operation: 'Model', ProviderAttempt: 1, InputTokens: 120 });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(() => metricDocument('user-controlled-operation', { ProviderAttempt: 1 })).toThrow();
});
test('logging failure cannot turn a completed paid request into an application failure', () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => { throw Error('sink failed'); });
  try { expect(() => recordMetrics('Feedback', { FeedbackStored: 1 })).not.toThrow(); }
  finally { log.mockRestore(); }
});
