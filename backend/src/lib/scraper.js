/**
 * Scraper utility integrating scrape.do API for Qlue's website module.
 */
const { getScraperApiKey } = require('./secrets');
const { ERROR_CODES, QlueError } = require('./errors');

// Minimal viable length of text extracted, otherwise we fail parsing.
const MIN_CONTENT_LENGTH = 200;

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Cleans raw HTML document using basic regex parsing.
 * In a fully productionized setup, use cheerio, but regex is sufficient for basic text stripping.
 */
function cleanHtmlToText(html) {
  let text = html || '';

  // 1. Extract body content if present
  const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    text = bodyMatch[1];
  }

  // 2. Remove script and style tags completely (multi-line aware)
  text = text.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, ' ');
  text = text.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, ' ');
  
  // 3. Remove nav and footer elements (multi-line aware)
  text = text.replace(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi, ' ');
  text = text.replace(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gi, ' ');
 
  // 4. Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
 
  // 5. Decode HTML entities (including numeric entities like &#8217;)
  text = text.replace(/&nbsp;/ig, ' ')
             .replace(/&amp;/ig, '&')
             .replace(/&lt;/ig, '<')
             .replace(/&gt;/ig, '>')
             .replace(/&quot;/ig, '"')
             .replace(/&#39;/ig, "'")
             .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
             .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

  // 6. Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Fetches content from a URL via scrape.do and cleans it.
 */
async function fetchAndCleanContent(url) {
  if (!isValidUrl(url)) {
    throw new QlueError('Invalid URL provided', ERROR_CODES.INVALID_URL, 400);
  }

  const apiKey = await getScraperApiKey();
  if (!apiKey) {
    throw new QlueError('Scraper API key not configured', ERROR_CODES.INTERNAL_ERROR, 500);
  }

  const encodedTargetUrl = encodeURIComponent(url);
  const scrapeApiUrl = `https://api.scrape.do?token=${apiKey}&url=${encodedTargetUrl}`;

  try {
    // Native Node v18+ fetch
    const response = await fetch(scrapeApiUrl);
    
    if (!response.ok) {
      throw new QlueError(`Scraper failed to fetch target URL. Status: ${response.status}`, ERROR_CODES.URL_UNREACHABLE, 400);
    }

    const htmlContent = await response.text();
    const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    const cleanedText = cleanHtmlToText(htmlContent);

    if (cleanedText.length < MIN_CONTENT_LENGTH) {
      throw new QlueError('Extracted content is too short for interviewing.', ERROR_CODES.CONTENT_TOO_SHORT, 400);
    }

    const wordCount = cleanedText.split(/\s+/).length;
    // Arbitrary conceptual extraction metric stub, Bedrock handles real conceptual splits later
    const conceptCount = Math.ceil(wordCount / 500); 

    return {
      content: cleanedText,
      title: title,
      conceptCount,
      wordCount
    };

  } catch (error) {
    if (error instanceof QlueError) throw error;
    throw new QlueError('Failed to scrape content', ERROR_CODES.URL_UNREACHABLE, 500, error.message);
  }
}

module.exports = {
  fetchAndCleanContent,
  cleanHtmlToText
};
