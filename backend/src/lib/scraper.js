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
/**
 * LinkedIn job URLs render nothing useful for scrapers behind a login wall,
 * BUT LinkedIn exposes an unauthenticated guest endpoint per job posting that
 * returns clean server-rendered HTML of the description. If we can pull the
 * numeric job id out of the URL, we rewrite to that endpoint — far more
 * reliable than trying to render the full logged-out job page.
 *
 * Handles: /jobs/view/1234567890, ...-1234567890 slug tails, and
 * ?currentJobId=1234567890 (LinkedIn's collections/search URLs).
 */
function linkedInGuestUrl(url) {
  if (!/linkedin\.com/i.test(url)) return null;
  const patterns = [
    /jobs\/view\/(\d{6,})/i,
    /currentJobId=(\d{6,})/i,
    /-(\d{10,})(?:[/?]|$)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${m[1]}`;
    }
  }
  return null;
}

// A desktop browser UA so plain fetches aren't trivially rejected by origins
// that block obvious bots/no-UA requests.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

/**
 * fetch() with a hard timeout so a hung origin can't stall the Lambda.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single fetch attempt through scrape.do with optional JS rendering and
 * residential ("super") proxies.
 */
async function scrapeDoFetch(apiKey, targetUrl, { render = false, superProxy = false } = {}) {
  const params = new URLSearchParams({ token: apiKey, url: targetUrl });
  if (render) params.set('render', 'true');
  if (superProxy) params.set('super', 'true');

  const response = await fetchWithTimeout(`https://api.scrape.do?${params.toString()}`, {}, 30000);
  if (!response.ok) {
    throw new QlueError(
      `Scraper failed to fetch target URL. Status: ${response.status}`,
      ERROR_CODES.URL_UNREACHABLE, 400
    );
  }
  return response.text();
}

/**
 * Direct fetch of the target URL — no proxy, no JS rendering. Free and instant,
 * and it works for the majority of public articles, docs and company career
 * pages. Used as the first tier when scrape.do isn't configured, and as the
 * last-ditch fallback when every proxied tier fails.
 */
async function directFetch(targetUrl) {
  const response = await fetchWithTimeout(targetUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  }, 12000);
  if (!response.ok) {
    throw new QlueError(
      `Direct fetch failed. Status: ${response.status}`,
      ERROR_CODES.URL_UNREACHABLE, 400
    );
  }
  return response.text();
}

/**
 * Fetches and cleans page content, escalating through cheaper -> pricier
 * strategies and stopping as soon as one yields enough text:
 *   1. LinkedIn guest job API rewrite (when applicable) — cheap & reliable
 *   2. plain proxy fetch — cheapest, works for static/company career pages
 *   3. JS rendering — for React/SPA job boards (Indeed, Greenhouse, Lever...)
 *   4. JS rendering + residential proxies — for aggressive anti-bot sites
 * Each tier costs more scrape.do credits, so we only escalate on failure.
 */
async function fetchAndCleanContent(url) {
  if (!isValidUrl(url)) {
    throw new QlueError('Invalid URL provided', ERROR_CODES.INVALID_URL, 400);
  }

  // The scrape.do key is optional now: without it we still attempt a direct
  // fetch, which handles most public pages. Key lookup failures are non-fatal.
  let apiKey = null;
  try {
    apiKey = await getScraperApiKey();
  } catch (keyErr) {
    console.warn('Scraper API key unavailable; falling back to direct fetch only:', keyErr.message);
  }

  // LinkedIn rewrite becomes the primary target when we can extract a job id.
  const guestUrl = linkedInGuestUrl(url);
  const primaryUrl = guestUrl || url;

  // Build the tier list cheapest -> most expensive. Direct fetch is always the
  // first tier (free, instant, works for most public pages). scrape.do tiers
  // are appended only when a key is configured, escalating from plain proxy to
  // JS rendering to residential proxies for aggressive anti-bot sites.
  const tiers = [{ kind: 'direct' }];
  if (apiKey) {
    tiers.push(
      { kind: 'scrapedo', render: false },
      { kind: 'scrapedo', render: true },
      { kind: 'scrapedo', render: true, superProxy: true }
    );
  }

  let lastError = null;
  let bestText = '';

  for (const tier of tiers) {
    try {
      const htmlContent = tier.kind === 'direct'
        ? await directFetch(primaryUrl)
        : await scrapeDoFetch(apiKey, primaryUrl, tier);

      const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;
      const cleanedText = cleanHtmlToText(htmlContent);

      if (cleanedText.length >= MIN_CONTENT_LENGTH) {
        const wordCount = cleanedText.split(/\s+/).length;
        return {
          content: cleanedText,
          title,
          conceptCount: Math.ceil(wordCount / 500),
          wordCount
        };
      }
      // Remember the most content we've seen in case every tier is thin.
      if (cleanedText.length > bestText.length) {
        bestText = cleanedText;
      }
    } catch (error) {
      lastError = error;
      // Try the next, stronger tier.
    }
  }

  // Every tier failed to reach MIN_CONTENT_LENGTH.
  if (bestText.length > 0) {
    throw new QlueError(
      'The page could not be read fully — this site heavily restricts automated access. Paste the text instead.',
      ERROR_CODES.CONTENT_TOO_SHORT, 400
    );
  }
  throw new QlueError(
    'Failed to scrape content',
    ERROR_CODES.URL_UNREACHABLE, 400,
    lastError?.message
  );
}

module.exports = {
  fetchAndCleanContent,
  cleanHtmlToText,
  linkedInGuestUrl
};
