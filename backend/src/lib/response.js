/**
 * API Gateway response format builders
 */

const baseHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Credentials': true,
  'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE,PATCH',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
};

const formatResponse = (statusCode, payload) => {
  return {
    statusCode,
    headers: { ...baseHeaders },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload)
  };
};

const success = (data, statusCode = 200) => {
  return formatResponse(statusCode, { success: true, data });
};

const created = (data) => {
  return formatResponse(201, { success: true, data });
};

const errorResponse = (statusCode, message, errorCode) => {
  const payload = { success: false, error: message };
  if (errorCode) {
    payload.code = errorCode;
  }
  return formatResponse(statusCode, payload);
};

const badRequest = (message, errorCode) => {
  return errorResponse(400, message, errorCode);
};

const unauthorized = (message, errorCode) => {
  return errorResponse(401, message, errorCode);
};

const forbidden = (message, errorCode) => {
  return errorResponse(403, message, errorCode);
};

const notFound = (message, errorCode) => {
  return errorResponse(404, message, errorCode);
};

const conflict = (message, errorCode) => {
  return errorResponse(409, message, errorCode);
};

const internalError = (message, errorCode) => {
  return errorResponse(500, message, errorCode || 'INTERNAL_ERROR');
};

module.exports = {
  success,
  created,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internalError
};
