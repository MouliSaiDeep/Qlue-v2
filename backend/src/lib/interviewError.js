// Public WebSocket error contract. Provider exception text never crosses it.
function classify(error) {
  const name = error?.code || error?.name || '';
  const status = error?.statusCode || error?.$metadata?.httpStatusCode;
  if (name === 'ACCOUNT_DELETING') return [403, 'ACCOUNT_DELETING', false, 'This account is unavailable.'];
  if (name === 'TURN_RECOVERY_EXHAUSTED') return [409, name, false, 'Interview recovery is exhausted. Your draft is retained.'];
  if (name === 'SERVICE_PAUSED' || name === 'QUOTA_EXCEEDED') return [status || 503, name, false, 'Interview service is paused or its usage limit has been reached.'];
  if (status === 401 || ['TOKEN_EXPIRED','TOKEN_INVALID'].includes(name)) return [401, 'AUTH_EXPIRED', true, 'Please refresh your sign-in to reconnect.'];
  if (status === 403) return [403, 'FORBIDDEN', false, 'You cannot access this interview.'];
  if (status === 404) return [404, 'SESSION_NOT_FOUND', false, 'This interview is unavailable.'];
  if (/Throttl|ThroughputExceeded|TooManyRequests/.test(name) || status === 429) return [429, 'THROTTLED', true, 'The service is busy. Recovery will retry automatically.'];
  if (/Timeout|Deadline|Abort|ETIMEDOUT/.test(name) || status === 504) return [504, 'DEADLINE_EXCEEDED', true, 'The service took too long. Recovery will retry automatically.'];
  if (name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException') return [409, 'STATE_CONFLICT', true, 'Interview state changed. Reconnecting automatically.'];
  // DynamoDB throttling/conditional failures themselves use HTTP 400. Match
  // their typed dependency errors before treating status 400 as validation.
  if (status === 400 || status === 422) return [400, 'INVALID_REQUEST', false, 'The interview request is invalid.'];
  // An unclassified implementation/storage error is a bounded 5xx recovery,
  // never mislabeled as candidate validation and never leaked to the APK.
  return [503, 'SERVICE_UNAVAILABLE', true, 'The interview service is temporarily unavailable. Recovery will retry automatically.'];
}
function frame(error, identity = {}, override = null) {
  const [code, category, retryable, message] = override || classify(error);
  const payload = {code, category, retryable, terminal: !retryable, error: message, timestamp: Date.now()};
  for (const key of ['sessionId','clientTurnId','turnId','requestId','operation']) {
    if (typeof identity[key] === 'string' && identity[key].length <= 200) payload[key] = identity[key];
  }
  if(Number.isSafeInteger(identity.turnIndex) && identity.turnIndex>=0) payload.turnIndex=identity.turnIndex;
  return {type: 'turn_error', payload};
}
module.exports = {classify, frame};
