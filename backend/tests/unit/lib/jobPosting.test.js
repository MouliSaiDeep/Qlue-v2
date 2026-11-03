jest.mock('../../../src/lib/ssrf', () => ({
  ...jest.requireActual('../../../src/lib/ssrf'), safeFetch: jest.fn()
}));
jest.mock('../../../src/lib/scraper', () => ({
  ...jest.requireActual('../../../src/lib/scraper'), fetchAndCleanContent: jest.fn()
}));
jest.mock('../../../src/lib/paidWork', () => ({
  assertRuntimeEnabled: jest.fn().mockResolvedValue(), beforePaidCall: jest.fn().mockResolvedValue()
}));
const { safeFetch } = require('../../../src/lib/ssrf');
const { fetchAndCleanContent } = require('../../../src/lib/scraper');
const paid = require('../../../src/lib/paidWork');
const deadline = require('../../../src/lib/deadline');
const { fetchJobPosting, linkedInJobUrl, guestDescription, readerDescription, MAX_READER_BYTES } = require('../../../src/lib/jobPosting');
const target = 'https://www.linkedin.com/jobs/view/4456864917/';
const guest = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4456864917';
const description = 'Responsibilities: You will build and maintain secure backend services and collaborate with product teams on reliable APIs. Requirements: Three years of experience with Node.js, relational databases, automated testing, and AWS infrastructure. Work with engineers to improve service performance and deployment processes.';
const html = `<html><body><nav>Unrelated jobs and sign in</nav><div class="show-more-less-html__markup"><p>${description}</p><div>Support production systems.</div><p>Final requirement: communicate clearly.</p></div><footer>More unrelated jobs</footer></body></html>`;
const envelope = (text = description, url = target) => `Title: Backend Engineer\n\nURL Source: ${url}\n\nMarkdown Content:\n${text}`;
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  safeFetch.mockResolvedValue({ body: html, finalUrl: guest });
  global.fetch = jest.fn(async () => new Response(envelope(), { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
});
afterEach(() => { global.fetch = originalFetch; });

test.each([
  [target, target],
  ['https://in.linkedin.com/jobs/view/backend-engineer-at-acme-4456864917?trackingId=private#about', target],
  ['https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4456864917&token=private', target],
  ['https://m.linkedin.com/jobs/view/4456864917', target],
  ['https://jobs.lever.co/company/id', null],
  ['https://linkedin.com.evil.example/jobs/view/4456864917', null],
  ['https://evillinkedin.com/jobs/view/4456864917', null]
])('normalizes only recognized LinkedIn hosts: %s', (url, result) => {
  expect(linkedInJobUrl(url)).toBe(result);
});
test.each([
  'https://www.linkedin.com/authwall', 'https://www.linkedin.com/jobs/search/?keywords=Node',
  'https://www.linkedin.com/jobs/view/123', 'https://www.linkedin.com/jobs/view/4456864917/extra',
  'https://www.linkedin.com/jobs/view/4456864917/?currentJobId=4483285627',
  'https://secret@www.linkedin.com/jobs/view/4456864917/',
  'https://www.linkedin.com:8443/jobs/view/4456864917/', 'file:///jobs/view/4456864917'
])('rejects unsupported/unsafe job URLs before any network access: %s', async url => {
  await expect(fetchJobPosting(url)).rejects.toThrow();
  expect(safeFetch).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();
});

test('isolates the full nested description and skips Jina when guest HTML works', async () => {
  const result = await fetchJobPosting(target);
  expect(result.source).toBe('linkedin-guest');
  expect(result.content).toContain('Final requirement: communicate clearly.');
  expect(result.content).not.toContain('unrelated');
  expect(safeFetch).toHaveBeenCalledWith(guest, { deadlineMs: expect.any(Number) });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('uses one anonymous, fixed-host reader fallback after public guest failure', async () => {
  safeFetch.mockRejectedValue(Object.assign(new Error('HTTP 403'), { code: 'URL_UNREACHABLE' }));
  const result = await fetchJobPosting(target + '?trackingId=secret');
  expect(result).toEqual({ content: description, source: 'jina-reader' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe('https://r.jina.ai/' + target);
  expect(options.redirect).toBe('error');expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options.headers['X-Respond-With']).toBeUndefined();
  expect(options.headers.Cookie).toBeUndefined();expect(options.headers.Authorization).toBeUndefined();
  expect(paid.beforePaidCall).toHaveBeenCalledWith('jdAnalysis');
});
test('retries an HTTP-200 login shell through Reader rather than grading it', async () => {
  safeFetch.mockResolvedValue({ body: '<body>Sign in to view this job. '.repeat(30), finalUrl: guest });
  expect((await fetchJobPosting(target)).source).toBe('jina-reader');
});
test.each(['ACCESS_FORBIDDEN', 'INVALID_URL', 'ACCOUNT_DELETING', 'QUOTA_EXCEEDED', 'SERVICE_PAUSED'])('never launders terminal %s failures through Reader', async code => {
  safeFetch.mockRejectedValue(Object.assign(new Error('blocked'), { code }));
  await expect(fetchJobPosting(target)).rejects.toMatchObject({ code });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('operator stop switch prevents both guest and reader requests', async () => {
  paid.assertRuntimeEnabled.mockRejectedValueOnce(Object.assign(new Error('paused'), { code: 'SERVICE_PAUSED' }));
  await expect(fetchJobPosting(target)).rejects.toMatchObject({ code: 'SERVICE_PAUSED' });
  expect(safeFetch).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();
});
test('reader provider guard failure prevents the outbound fallback', async () => {
  safeFetch.mockRejectedValue(new Error('unreachable'));
  paid.beforePaidCall.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 'QUOTA_EXCEEDED' }));
  await expect(fetchJobPosting(target)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(global.fetch).not.toHaveBeenCalled();
});
test.each([
  envelope('Sign in to view this job. '.repeat(30)),
  envelope(description, 'https://www.linkedin.com/authwall'),
  envelope(description, 'https://www.linkedin.com/jobs/view/4483285627/'),
  envelope(description, 'https://www.linkedin.com/jobs/search/?keywords=Node'),
  envelope('This job is no longer available. ' + description),
  envelope('No longer accepting applications. ' + description),
  envelope('Verify you are human. ' + description),
  envelope('Recommended jobs in London. '.repeat(30)),
  envelope('tiny'),
  'Warning: Target URL returned error 403\n' + envelope(description),
  description,
  `URL Source: ${target}\n${description}`
])('rejects blocked, partial or mismatched Reader output', body => {
  expect(() => readerDescription(body, target)).toThrow();
});
test('rejects a guest description without its closing boundary', () => {
  expect(() => guestDescription(html.replace('</div><footer>', '<footer>'))).toThrow();
});
test.each([403, 429, 500])('Reader HTTP %s fails once with paste fallback', async status => {
  safeFetch.mockRejectedValue(new Error('unreachable'));
  global.fetch.mockResolvedValue(new Response('blocked', { status }));
  await expect(fetchJobPosting(target)).rejects.toMatchObject({ code: 'CONTENT_TOO_SHORT' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('rejects unexpected binary output and oversized Reader streams', async () => {
  safeFetch.mockRejectedValue(new Error('unreachable'));
  global.fetch.mockResolvedValueOnce(new Response(envelope(), { headers: { 'content-type': 'application/octet-stream' } }));
  await expect(fetchJobPosting(target)).rejects.toThrow();
  global.fetch.mockResolvedValueOnce(new Response('x'.repeat(MAX_READER_BYTES + 1), { headers: { 'content-type': 'text/plain' } }));
  await expect(fetchJobPosting(target)).rejects.toThrow();
});
test('deadline aborts a Reader body that stalls after sending headers', async () => {
  safeFetch.mockRejectedValue(new Error('unreachable')); let signal;
  global.fetch.mockImplementation(async (_, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    } }), { headers: { 'content-type': 'text/plain' } });
  });
  await expect(fetchJobPosting(target, { deadlineMs: 400 })).rejects.toThrow();
  expect(signal.aborted).toBe(true);
});
test('exhausted parent deadline starts no Reader request', async () => {
  await deadline.withDeadline(null, async () => {
    await expect(fetchJobPosting(target)).rejects.toThrow();
  }, { maxMs: 1, reserveMs: 2 });
  expect(global.fetch).not.toHaveBeenCalled();
});
test('non-LinkedIn job sites retain the existing guarded scraper', async () => {
  fetchAndCleanContent.mockResolvedValue({ content: description });
  expect(await fetchJobPosting('https://job-boards.greenhouse.io/acme/jobs/123')).toEqual({ content: description });
  expect(fetchAndCleanContent).toHaveBeenCalledWith('https://job-boards.greenhouse.io/acme/jobs/123');
  expect(safeFetch).not.toHaveBeenCalled();expect(global.fetch).not.toHaveBeenCalled();
});
