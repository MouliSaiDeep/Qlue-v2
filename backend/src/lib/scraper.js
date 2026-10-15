const diagnostics=require('./logger').safeConsole;
/**
 * Scraper utility integrating scrape.do API for Qlue's website module.
 */
const { getScraperApiKey } = require('./secrets');
const { ERROR_CODES, QlueError } = require('./errors');
const { safeFetch } = require('./ssrf');

// Minimal viable length of text extracted, otherwise we fail parsing.
const MIN_CONTENT_LENGTH = 200;

// One total wall-clock budget for the ENTIRE tiered fetch (finding 10). Every
// fallback tier shares this deadline instead of restarting its own full 30s
// allowance, so a slow/anti-bot site cannot push a synchronous caller (JD
// analysis, website init, the /scraper/fetch route) past API Gateway's ~29s
// integration timeout — which would strand the client with an unexplained 504
// while the Lambda keeps burning scrape.do credits. Overridable via env.
const SCRAPE_TOTAL_DEADLINE_MS = Number(process.env.SCRAPE_TOTAL_DEADLINE_MS) || 25000;

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

/**
 * fetch() with a hard timeout so a hung origin can't stall the Lambda.
 * Only used for the trusted scrape.do proxy endpoint; user-controlled
 * destinations go through safeFetch instead.
 *
 * R-07: fetch() resolves as soon as response HEADERS arrive — the body is still
 * streaming at that point. The previous version cleared the abort timer the
 * instant fetch() resolved, so the body read (response.text()) ran with NO
 * timeout at all: a proxy that sent headers and then stalled the body could hang
 * the Lambda well past the caller's budget (and past API Gateway's ~29s limit).
 * The body is now consumed INSIDE the timeout window via `consume`, so the abort
 * covers connect + headers + the full body read.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000, consume) {
  const deadlineAt=require('./deadline').absolute(timeoutMs);
  return require('./deadline').bounded(async signal=>{
    const response=await fetch(url,{...options,signal});
    return consume?consume(response,deadlineAt):response;
  },{deadlineAt,label:'proxyDownload'});
}

/**
 * Single fetch attempt through scrape.do with optional JS rendering and
 * residential ("super") proxies.
 */
async function scrapeDoFetch(apiKey, targetUrl, { render = false, superProxy = false, timeoutMs = 30000 } = {}) {
  await require('./paidWork').beforePaidCall('scrape');
  const params = new URLSearchParams({ token: apiKey, url: targetUrl });
  if (render) params.set('render', 'true');
  if (superProxy) params.set('super', 'true');

  // The ok-check and body read both run inside fetchWithTimeout's abort window
  // (R-07), so a stalled body is torn down at timeoutMs instead of hanging.
  return fetchWithTimeout(`https://api.scrape.do?${params.toString()}`, {}, timeoutMs, async (response,deadlineAt) => {
    if (!response.ok) {
      throw new QlueError(
        `Scraper failed to fetch target URL. Status: ${response.status}`,
        ERROR_CODES.URL_UNREACHABLE, 400
      );
    }
    const chunks=[]; let bytes=0;
    if (!response.body) throw new Error('Proxy response body is unavailable');
    for await (const chunk of require('./deadline').streamBounded(response.body,{maxBytes:2*1024*1024,deadlineAt,label:'proxyBody'})) {
      bytes+=chunk.length;
      if(bytes>2*1024*1024) throw new QlueError('Proxy response exceeds byte limit',ERROR_CODES.ACCESS_FORBIDDEN,400);
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  });
}

/**
 * Direct fetch of the target URL — no proxy, no JS rendering. Free and instant,
 * and it works for the majority of public articles, docs and company career
 * pages. Used as the first tier when scrape.do isn't configured, and as the
 * last-ditch fallback when every proxied tier fails.
 *
 * SSRF-guarded: the destination is user-controlled, so this goes through
 * safeFetch (see lib/ssrf.js), which blocks private/loopback/link-local/reserved
 * hosts, pins the connection to a validated IP (no DNS-rebind window),
 * re-validates every redirect hop, and streams the body under a byte ceiling.
 */
async function directFetch(targetUrl, timeoutMs = 12000) {
  const { body } = await safeFetch(targetUrl, { deadlineMs: timeoutMs });
  return body;
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
async function fetchAndCleanContent(url, { deadlineMs = SCRAPE_TOTAL_DEADLINE_MS, now = Date.now } = {}) {
  if (!isValidUrl(url)) {
    throw new QlueError('Invalid URL provided', ERROR_CODES.INVALID_URL, 400);
  }

  // One shared deadline for the whole escalation (finding 10). `remaining()`
  // is what's left of the total budget; each tier is capped to it so no single
  // attempt — nor the sum of all of them — can outlive the caller's deadline.
  const start = now();
  const remaining = () => Math.min(deadlineMs - (now() - start), require('./deadline').remaining());

  // The scrape.do key is optional now: without it we still attempt a direct
  // fetch, which handles most public pages. Key lookup failures are non-fatal.
  let apiKey = null;
  try {
    apiKey = await require('./deadline').bounded(()=>getScraperApiKey(),{deadlineAt:require('./deadline').absolute(Math.min(2000,remaining())),label:'scraperSecret'});
  } catch (keyErr) {
    diagnostics.warn('Scraper API key unavailable; falling back to direct fetch only:', keyErr.name);
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
    // Shared-deadline gate (finding 10): once the total budget is spent, stop
    // escalating rather than kicking off another multi-second tier that would
    // run past the gateway/client deadline. Cap this tier to the time left.
    const budget = remaining();
    if (budget <= 0) break;

    try {
      const htmlContent = tier.kind === 'direct'
        ? await directFetch(primaryUrl, Math.min(budget, 12000))
        : await scrapeDoFetch(apiKey, primaryUrl, { ...tier, timeoutMs: Math.min(budget, 30000) });

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
      // R-01: a forbidden destination is TERMINAL — never escalate it to the
      // scrape.do proxy. The direct tier runs through the SSRF guard (safeFetch);
      // an ACCESS_FORBIDDEN here means this user-controlled URL was refused
      // (private/loopback/metadata host, blocked port, a redirect into a private
      // host, or a disallowed response type/size). scrape.do has NO SSRF guard,
      // so handing it the same destination would launder exactly what we just
      // blocked. Only genuine unreachability (timeouts, origin HTTP errors,
      // anti-bot blocks → URL_UNREACHABLE) should fall through to the proxy.
      if (['ACCESS_FORBIDDEN','SERVICE_PAUSED','ACCOUNT_DELETING','QUOTA_EXCEEDED'].includes(error.code)) {
        throw error;
      }
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
