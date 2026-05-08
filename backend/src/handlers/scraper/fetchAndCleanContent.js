const { createLogger } = require('../../lib/logger');
const { fetchAndCleanContent } = require('../../lib/scraper');
const { success, badRequest, internalError } = require('../../lib/response');
const { QlueError } = require('../../lib/errors');

/**
 * Lambda handler for fetching and cleaning website content.
 * Expected event body: { url: "https://example.com" }
 */
exports.handler = async (event, context) => {
  const logger = createLogger(context);
  logger.info('FetchAndCleanContent request received', { event });

  try {
    let body;
    if (typeof event.body === 'string') {
      body = JSON.parse(event.body);
    } else {
      body = event.body || {};
    }

    const { url } = body;

    if (!url) {
      return badRequest('URL is required in request body');
    }

    logger.info('Fetching content for URL', { url });
    const result = await fetchAndCleanContent(url);

    logger.info('Content successfully fetched and cleaned', { 
      url, 
      wordCount: result.wordCount,
      conceptCount: result.conceptCount
    });

    return success(result);

  } catch (error) {
    logger.error('Error in FetchAndCleanContent', { 
      error: error.message, 
      stack: error.stack,
      code: error.code 
    });

    if (error instanceof QlueError) {
      return badRequest(error.message, error.code);
    }

    return internalError('An unexpected error occurred during content fetching');
  }
};
