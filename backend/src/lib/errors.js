/**
 * Error classes and code constants for Qlue application.
 */

// Custom Error Class
class QlueError extends Error {
  constructor(message, code, statusCode = 500, details = null) {
    super(message);
    this.name = 'QlueError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Fixed Error Codes mapping
const ERROR_CODES = {
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  INVALID_EMAIL: 'INVALID_EMAIL',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  INVALID_DISPLAY_NAME: 'INVALID_DISPLAY_NAME',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  ACTIVE_SESSION_EXISTS: 'ACTIVE_SESSION_EXISTS',
  RESUME_NOT_PARSED: 'RESUME_NOT_PARSED',
  INVALID_MODULE_TYPE: 'INVALID_MODULE_TYPE',
  RESUME_LIMIT_EXCEEDED: 'RESUME_LIMIT_EXCEEDED',
  DUPLICATE_RESUME: 'DUPLICATE_RESUME',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  URL_UNREACHABLE: 'URL_UNREACHABLE',
  ACCESS_FORBIDDEN: 'ACCESS_FORBIDDEN',
  CONTENT_TOO_SHORT: 'CONTENT_TOO_SHORT',
  INVALID_URL: 'INVALID_URL',
  BEDROCK_TIMEOUT: 'BEDROCK_TIMEOUT',
  BEDROCK_ERROR: 'BEDROCK_ERROR',
  POLLY_ERROR: 'POLLY_ERROR',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  FEEDBACK_NOT_FOUND: 'FEEDBACK_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

/**
 * Determines if an error implies an operation can be safely retried.
 */
function isRetryable(error) {
  if (error instanceof QlueError) {
    return error.code === ERROR_CODES.BEDROCK_TIMEOUT || error.code === ERROR_CODES.POLLY_ERROR;
  }
  
  // Handing generic network/AWS rate-limiting errors
  if (error.$metadata && error.$metadata.httpStatusCode === 429) {
    return true;
  }
  
  if (error.code && (error.code.includes('Timeout') || error.code.includes('Throttl'))) {
    return true;
  }

  return false;
}

/**
 * Derives a normalized error code from HTTP status code
 */
function getErrorCode(httpStatus, context = '') {
  switch (httpStatus) {
    case 400: return `BAD_REQUEST_ERROR_${context}`.toUpperCase();
    case 401: return ERROR_CODES.TOKEN_INVALID;
    case 403: return ERROR_CODES.ACCESS_FORBIDDEN;
    case 404: return `NOT_FOUND_ERROR_${context}`.toUpperCase();
    case 409: return `CONFLICT_ERROR_${context}`.toUpperCase();
    case 429: return `RATE_LIMIT_ERROR_${context}`.toUpperCase();
    case 500:
    default: return ERROR_CODES.INTERNAL_ERROR;
  }
}

module.exports = {
  QlueError,
  ERROR_CODES,
  isRetryable,
  getErrorCode
};
