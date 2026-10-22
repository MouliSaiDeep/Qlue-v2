// Explicit allowlists keep tokens, audio, transcripts and user IDs out of EMF.
export function streamMetric(value, now = Date.now()) {
  const authenticated = value.authenticated === true;
  const counts = {
    StreamEnded: 1,
    StreamCompleted: Number(authenticated && value.status === 'FINISHED'),
    StreamInterrupted: Number(authenticated && value.status !== 'FINISHED'),
    StreamRejected: Number(!authenticated),
    EvidencePersistenceFailed: Number(value.status === 'PERSISTENCE_FAILED'),
  };
  const metrics = Object.fromEntries(Object.entries(counts).map(([name, n]) => [name, { value: n, unit: 'Count' }]));
  for (const [name, raw, unit] of [
    ['AudioSeconds', value.receivedBytes / 32000, 'Seconds'],
    ['StreamDurationMs', value.totalMs, 'Milliseconds'],
    ['FirstPartialMs', value.firstPartialMs, 'Milliseconds'],
  ]) {
    if (Number.isFinite(raw) && raw >= 0) metrics[name] = { value: raw, unit };
  }
  return {
    _aws: { Timestamp: now, CloudWatchMetrics: [{ Namespace: 'Qlue/Audio', Dimensions: [['Service']],
      Metrics: Object.entries(metrics).map(([Name, m]) => ({ Name, Unit: m.unit })) }] },
    Service: 'audio-gateway',
    ...Object.fromEntries(Object.entries(metrics).map(([name, m]) => [name, m.value])),
  };
}
