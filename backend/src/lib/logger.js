/**
 * Logger utility for structured JSON logging with context propagation.
 */

const createLogger = (context = {}) => {
  const baseLog = (level, message, data = {}) => {
    const timestamp = new Date().toISOString();
    const requestId = context.awsRequestId || 'N/A';
    const functionName = context.functionName || 'N/A';
    
    const logEntry = {
      timestamp,
      level,
      requestId,
      functionName,
      message,
      ...(Object.keys(data).length > 0 && { data })
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
  createTimer
};
