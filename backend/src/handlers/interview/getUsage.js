const diagnostics=require('../../lib/logger').safeConsole;
const { getUserById } = require('../../models/user');
const { getUserTier, getUsage } = require('../../lib/quota');
const { success, unauthorized, internalError } = require('../../lib/response');

/**
 * GET /interview/usage — returns the caller's daily interview quota usage so the
 * client can show "N of M free interviews left today" without starting one.
 */
exports.handler = async (event) => {
  try {
    const authorizer = event.requestContext?.authorizer;
    const userId = authorizer?.uid || authorizer?.principalId || authorizer?.claims?.sub;
    if (!userId) {
      return unauthorized('Unauthorized. User ID required.');
    }

    const user = await getUserById(userId);
    const tier = getUserTier(user);
    const usage = await getUsage(userId, tier);

    return success(usage);
  } catch (err) {
    diagnostics.error('GetUsage failed:', err);
    return internalError('Could not load usage.');
  }
};
