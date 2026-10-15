/**
 * Logger utility for structured JSON logging with context propagation.
 *
 * Security (audit finding 6): every logged `data` payload is passed through a
 * central redactor before serialization. Handlers must still avoid dumping whole
 * API-Gateway events or stored DynamoDB items, but this is the backstop that
 * masks credentials, tokens, signed URLs and other secrets if one slips through.
 */

// Key names whose values are secrets/PII and must never be logged in clear.
const SENSITIVE_KEY_RE =
  /(authorization|auth|password|passwd|secret|token|apikey|api[_-]?key|credential|cookie|session[_-]?id|signature|x-amz-security-token|set-cookie|refresh|id[_-]?token|access[_-]?token|private[_-]?key|transcript|prompt|content|parsedData|displayName|email|text|body|resumeSummary)/i;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING = 2048;

// Signed URLs (S3 presigned, scrape.do tokens, etc.) leak credentials in their
// query string — keep the path, drop the query.
function maskUrlLike(str) {
  if (/[?&](x-amz-signature|x-amz-credential|signature|token|awsaccesskeyid)=/i.test(str)) {
    const q = str.indexOf('?');
    return (q === -1 ? str : str.slice(0, q)) + '?[REDACTED_QUERY]';
  }
  str=str.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]');
  if (str.length > MAX_STRING) return str.slice(0, MAX_STRING) + '…[truncated]';
  return str;
}

function redact(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return maskUrlLike(value);
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => redact(v, depth + 1, seen));
  }
  // Error objects: keep message/name/code, never enumerable secret props. The
  // message is attacker/third-party-influenced free text (e.g. a failed fetch to
  // a signed URL), so it must go through the same URL/query masking as any other
  // logged string (R-08) — name/code are safe identifiers.
  if (value instanceof Error) {
    const message = '[REDACTED_ERROR_MESSAGE]';
    return { name: value.name, message, code: value.code };
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

const createLogger = (context = {}) => {
  const baseLog = (level, message, data = {}) => {
    const timestamp = new Date().toISOString();
    const requestId = context.awsRequestId || 'N/A';
    const functionName = context.functionName || 'N/A';

    let safeData;
    try {
      safeData = redact(data);
    } catch (_) {
      safeData = '[unserializable data]';
    }

    const logEntry = {
      timestamp,
      level,
      requestId,
      functionName,
      message: redact(message),
      ...(safeData && Object.keys(safeData).length > 0 && { data: safeData })
    };

    // AWS CloudWatch prefers standard out/err
    if (level === 'ERROR') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'WARN') {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  };

  return {
    info: (message, data) => baseLog('INFO', message, data),
    error: (message, data) => baseLog('ERROR', message, data),
    warn: (message, data) => baseLog('WARN', message, data),
    debug: (message, data) => {
      if (process.env.LOG_LEVEL === 'DEBUG') {
        baseLog('DEBUG', message, data);
      }
    }
  };
};

const createTimer = () => {
  const timers = new Map();
  return {
    start: (label) => {
      timers.set(label, process.hrtime());
    },
    stop: (label) => {
      const start = timers.get(label);
      if (!start) {
        return -1; // Timer not started
      }
      const end = process.hrtime(start);
      // return duration in milliseconds
      return (end[0] * 1000) + (end[1] / 1000000);
    }
  };
};

module.exports = {
  createLogger,
  createTimer,
  redact
};

// All application diagnostics use the same redactor. Avoid retaining free-text
// provider Error messages, which can contain personal input and credentials.
module.exports.safeConsole=Object.fromEntries(['log','info','warn','error','debug'].map(level=>[level,(...args)=>{
  try {console[level](...args.map(value=>redact(value)));}
  catch {console[level]('[unserializable diagnostic]');}
}]));
