/**
 * Tests for the scraper's tiered fetch — specifically the new direct-fetch
 * fallback that makes links parse even without a scrape.do key.
 */
jest.mock('../../../src/lib/secrets');
const { getScraperApiKey } = require('../../../src/lib/secrets');
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => htmlPage
    });

    const result = await fetchAndCleanContent('https://example.com/k8s');

    expect(result.title).toBe('Intro to Kubernetes');
    expect(result.content).toContain('Kubernetes');
    expect(result.wordCount).toBeGreaterThan(50);
    // Direct fetch hit the target URL itself (not the scrape.do endpoint).
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/k8s',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('does not hard-fail when the API key lookup throws', async () => {
    getScraperApiKey.mockRejectedValue(new Error('SSM ParameterNotFound'));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => htmlPage });

    const result = await fetchAndCleanContent('https://example.com/k8s');
    expect(result.content).toContain('Kubernetes');
  });

  it('escalates to scrape.do tiers when direct fetch returns too little text', async () => {
    getScraperApiKey.mockResolvedValue('key-123');
    global.fetch = jest.fn()
      // tier 1: direct fetch — thin page
      .mockResolvedValueOnce({ ok: true, text: async () => '<html><body>tiny</body></html>' })
      // tier 2: scrape.do plain proxy — full content
      .mockResolvedValueOnce({ ok: true, text: async () => htmlPage });

    const result = await fetchAndCleanContent('https://example.com/k8s');
    expect(result.content).toContain('Kubernetes');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toContain('api.scrape.do');
  });
});

describe('cleanHtmlToText', () => {
  it('strips scripts/styles and decodes entities', () => {
    const html = '<body><script>evil()</script><p>Ben &amp; Jerry&#39;s</p></body>';
    expect(cleanHtmlToText(html)).toBe("Ben & Jerry's");
  });
});
