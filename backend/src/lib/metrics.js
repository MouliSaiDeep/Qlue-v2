// CloudWatch Embedded Metric Format. All names and dimensions are bounded;
// callers cannot accidentally attach transcripts, tokens, URLs or identities.
const UNITS = Object.freeze({ ProviderAttempt: 'Count', ProviderSuccess: 'Count', ProviderFailure: 'Count',
  InputTokens: 'Count', OutputTokens: 'Count', ProviderLatencyMs: 'Milliseconds',
  FeedbackStored: 'Count', FeedbackUnavailable: 'Count' });
function metricDocument(operation, values, now = Date.now()) {
  if (!['Model', 'Feedback'].includes(operation)) throw new Error('Unknown metric operation');
  const entries = Object.entries(values).filter(([name, value]) => UNITS[name] && Number.isFinite(value) && value >= 0);
  if (!entries.length) return null;
  return { _aws: { Timestamp: now, CloudWatchMetrics: [{ Namespace: 'Qlue/Application',
    Dimensions: [['Operation']], Metrics: entries.map(([Name]) => ({ Name, Unit: UNITS[Name] })) }] },
    Operation: operation, ...Object.fromEntries(entries) };
}
function recordMetrics(operation, values) {
  // Telemetry failure must not retry a paid operation or hide a saved report.
  try { const document = metricDocument(operation, values); if (document) console.log(JSON.stringify(document)); } catch (_) {}
}
module.exports = { metricDocument, recordMetrics };
