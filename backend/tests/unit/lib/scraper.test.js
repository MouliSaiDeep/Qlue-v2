/**
 * Tests for the scraper's tiered fetch — specifically the direct-fetch fallback
 * that makes links parse even without a scrape.do key. The direct tier now goes
 * through the SSRF-safe fetch (lib/ssrf), so that is mocked here; the scrape.do
 * tiers still use global.fetch against the trusted proxy endpoint.
 */
jest.mock('../../../src/lib/secrets');
jest.mock('../../../src/lib/ssrf');
const { getScraperApiKey } = require('../../../src/lib/secrets');
const { safeFetch } = require('../../../src/lib/ssrf');
const { fetchAndCleanContent, cleanHtmlToText } = require('../../../src/lib/scraper');

const longBody = 'Kubernetes is an open-source container orchestration platform. '.repeat(20);
const htmlPage = `<html><head><title>Intro to Kubernetes</title></head><body><p>${longBody}</p></body></html>`;

describe('fetchAndCleanContent — direct-fetch fallback', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.clearAllMocks();
  });

  it('parses a public page via direct fetch when no scrape.do key is configured', async () => {
    getScraperApiKey.mockResolvedValue(null); // no key
    safeFetch.mockResolvedValue({ body: htmlPage, contentType: 'text/html', finalUrl: 'https://example.com/k8s' });

    const result = await fetchAndCleanContent('https://example.com/k8s');

    expect(result.title).toBe('Intro to Kubernetes');
    expect(result.content).toContain('Kubernetes');
    expect(result.wordCount).toBeGreaterThan(50);
    // Direct tier went through the SSRF-safe fetch against the target URL itself.
    expect(safeFetch).toHaveBeenCalledWith('https://example.com/k8s', expect.any(Object));
  });

  it('does not hard-fail when the API key lookup throws', async () => {
    getScraperApiKey.mockRejectedValue(new Error('SSM ParameterNotFound'));
    safeFetch.mockResolvedValue({ body: htmlPage, contentType: 'text/html', finalUrl: 'https://example.com/k8s' });

    const result = await fetchAndCleanContent('https://example.com/k8s');
    expect(result.content).toContain('Kubernetes');
  });

  it('escalates to scrape.do tiers when direct fetch returns too little text', async () => {
    getScraperApiKey.mockResolvedValue('key-123');
    // tier 1: direct (SSRF-safe) fetch — thin page
    safeFetch.mockResolvedValue({ body: '<html><body>tiny</body></html>', contentType: 'text/html', finalUrl: 'https://example.com/k8s' });
    // tier 2: scrape.do plain proxy — full content
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, body: (async function*(){yield Buffer.from(htmlPage);})() });

    const result = await fetchAndCleanContent('https://example.com/k8s');
    expect(result.content).toContain('Kubernetes');
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('api.scrape.do');
  });

  it('propagates an SSRF block from the direct tier when there is no scrape.do key', async () => {
    getScraperApiKey.mockResolvedValue(null);
    const { QlueError, ERROR_CODES } = require('../../../src/lib/errors');
    safeFetch.mockRejectedValue(new QlueError('URL host is not allowed', ERROR_CODES.ACCESS_FORBIDDEN, 400));

    // With no scrape.do fallback tier, a blocked direct fetch surfaces as a failure.
    await expect(fetchAndCleanContent('http://127.0.0.1/internal')).rejects.toThrow();
  });

  it('treats an SSRF-forbidden destination as terminal — never laundered through scrape.do (R-01)', async () => {
    // A key IS configured, so the proxy tiers exist. But a forbidden destination
    // (here: cloud metadata) must NOT be escalated to scrape.do, which has no
    // SSRF guard and would happily fetch the private target on our behalf.
    getScraperApiKey.mockResolvedValue('key-123');
    const { QlueError, ERROR_CODES } = require('../../../src/lib/errors');
    safeFetch.mockRejectedValue(new QlueError('URL resolves to a private address', ERROR_CODES.ACCESS_FORBIDDEN, 400));
    global.fetch = jest.fn(); // scrape.do tiers — must stay untouched

    await expect(fetchAndCleanContent('http://169.254.169.254/latest/meta-data/'))
      .rejects.toMatchObject({ code: ERROR_CODES.ACCESS_FORBIDDEN });
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled(); // the forbidden host never reached the proxy
  });

  it('escalates to scrape.do when the direct tier is unreachable, not forbidden (R-01 contrast)', async () => {
    // The terminal rule is specific to ACCESS_FORBIDDEN. A public site that
    // merely blocks or errors on direct fetch (URL_UNREACHABLE) must still fall
    // through to the proxy — that is the whole point of the paid tiers.
    getScraperApiKey.mockResolvedValue('key-123');
    const { QlueError, ERROR_CODES } = require('../../../src/lib/errors');
    safeFetch.mockRejectedValue(new QlueError('URL returned HTTP 403', ERROR_CODES.URL_UNREACHABLE, 400));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, body: (async function*(){yield Buffer.from(htmlPage);})() });

    const result = await fetchAndCleanContent('https://example.com/k8s');
    expect(result.content).toContain('Kubernetes');
    expect(global.fetch).toHaveBeenCalledTimes(1); // escalated to the proxy
    expect(global.fetch.mock.calls[0][0]).toContain('api.scrape.do');
  });

  it('keeps the abort timer armed across the scrape.do body read (R-07)', async () => {
    // fetch() resolves at header arrival; the body stream is still open. This
    // proxy sends headers immediately, then its body read (text()) only ever
    // settles when the AbortController fires. If the timeout did not cover the
    // body read, text() would hang forever and this test would time out.
    getScraperApiKey.mockResolvedValue('key-123');
    // Direct tier returns a thin page so we escalate into the scrape.do tier.
    safeFetch.mockResolvedValue({ body: '<html><body>tiny</body></html>', contentType: 'text/html', finalUrl: 'https://example.com/x' });

    let bodySignal = null;
    global.fetch = jest.fn((url, opts) => {
      bodySignal = opts.signal;
      return Promise.resolve({
        ok: true,
        body: { [Symbol.asyncIterator]() {return {next:()=>new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('The operation was aborted'))))};} },
      });
    });

    // Short total budget so the per-tier timeout (and thus the body-read abort)
    // fires quickly. The call ultimately rejects (CONTENT_TOO_SHORT once the
    // budget is spent); what matters is that the body read was aborted.
    await expect(
      fetchAndCleanContent('https://example.com/x', { deadlineMs: 100 })
    ).rejects.toThrow();

    expect(bodySignal).not.toBeNull();
    expect(bodySignal.aborted).toBe(true); // the abort reached the body read, not just the headers
  }, 10000);

  it('shares one total deadline across tiers instead of restarting the allowance per tier', async () => {
    // Finding 10: the four tiers must not each get a fresh multi-second
    // allowance. Once the total budget is spent, escalation stops — so a slow
    // site can't push the synchronous caller past the ~29s gateway timeout.
    getScraperApiKey.mockResolvedValue('key-123');
    const thin = '<html><body>too short</body></html>';
    safeFetch.mockResolvedValue({ body: thin, contentType: 'text/html', finalUrl: 'https://example.com/x' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, body: (async function*(){yield Buffer.from(thin);})() });

    // Injected clock: the direct tier runs (elapsed ~1s), then the budget is
    // spent (~26s), so no scrape.do tier may start even with a key configured.
    const stamps = [0, 0, 1000, 26000, 26000, 26000];
    let i = 0;
    const now = () => stamps[Math.min(i++, stamps.length - 1)];

    await expect(
      fetchAndCleanContent('https://example.com/x', { now })
    ).rejects.toThrow();

    expect(safeFetch).toHaveBeenCalledTimes(1); // direct tier ran once
    expect(global.fetch).not.toHaveBeenCalled(); // no paid scrape.do tier started
  });
});

describe('cleanHtmlToText', () => {
  it('strips scripts/styles and decodes entities', () => {
    const html = '<body><script>evil()</script><p>Ben &amp; Jerry&#39;s</p></body>';
    expect(cleanHtmlToText(html)).toBe("Ben & Jerry's");
  });
});
