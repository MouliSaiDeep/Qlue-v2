// Public LinkedIn job import: bounded guest HTML, then anonymous Jina Reader.
// No shell commands, browser sessions, cookies or arbitrary proxy targets.
const { safeFetch, parseUrl } = require('./ssrf');
const { fetchAndCleanContent, cleanHtmlToText, linkedInGuestUrl } = require('./scraper');
const deadline = require('./deadline');
const { QlueError, ERROR_CODES } = require('./errors');
const MAX_READER_BYTES = 128 * 1024;
const MAX_CONTENT_CHARS = 60000;
const TERMINAL = new Set(['ACCESS_FORBIDDEN', 'INVALID_URL', 'SERVICE_PAUSED', 'ACCOUNT_DELETING', 'QUOTA_EXCEEDED']);
const unavailable = () => new QlueError(
  'Could not read a complete public job description. The posting may be restricted or expired. Paste the job description or upload its PDF instead.',
  ERROR_CODES.CONTENT_TOO_SHORT, 400);

function linkedInJobUrl(raw) {
  const { url } = parseUrl(raw);
  if (!/^(?:(?:www|m|[a-z]{2})\.)?linkedin\.com$/i.test(url.hostname)) return null;
  const pathId = url.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d{6,20})\/?$/)?.[1];
  const queryId = /^\/jobs(?:\/|$)/.test(url.pathname) ? url.searchParams.get('currentJobId') : null;
  if (pathId && queryId && pathId !== queryId) throw unavailable();
  const id = pathId || queryId;
  if (!/^\d{6,20}$/.test(id || '')) throw unavailable();
  // Never send tracking parameters, credentials, arbitrary paths or user-selected
  // proxy destinations to a third party. The target is constructed from an ID.
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

function validateDescription(text) {
  const content = String(text || '').replace(/\s+/g, ' ').trim();
  if (content.length < 200 || content.length > MAX_CONTENT_CHARS) throw unavailable();
  if (/no longer accepting applications|(?:this |the )?(?:job|position|posting) (?:is |has )?(?:no longer available|closed|expired)|page (?:was )?not found|verify (?:that )?you(?:'re| are) human|security verification|captcha|access denied|sign in to (?:view|continue)|join (?:linkedin )?to view/i.test(content)) throw unavailable();
  const duties = /\bresponsibilit(?:y|ies)\b|\bduties\b|\bwhat you(?:['’]ll| will) do\b|\byou will\b|\byour role\b|\babout (?:the|this) role\b/i;
  const requirements = /\bqualifications?\b|\brequirements?\b|\bskills?\b|\bexperience\b|\bwhat (?:you(?:['’]ll| will) bring|we(?:['’]re| are) looking for)\b/i;
  if (!duties.test(content) || !requirements.test(content)) throw unavailable();
  return content;
}

// LinkedIn's guest HTML contains a dedicated description div. Preserve nested
// divs; matching only the first closing tag would silently truncate a posting.
function guestDescription(html) {
  const start = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bshow-more-less-html__markup\b[^"']*["'][^>]*>/i.exec(html);
  if (!start) throw unavailable();
  const offset = start.index + start[0].length;
  const tags = /<\/?div\b[^>]*>/gi; tags.lastIndex = offset;
  let depth = 1, match;
  while ((match = tags.exec(html))) {
    depth += /^<\//.test(match[0]) ? -1 : 1;
    if (depth === 0) return validateDescription(cleanHtmlToText(html.slice(offset, match.index)));
  }
  throw unavailable();
}

function readerDescription(body, target) {
  // Reader's plain-text envelope identifies the page it actually extracted.
  // Reject redirected login/search pages and different job IDs, even on HTTP 200.
  if (/^Warning:.*(?:error|captcha|blocked|denied|incomplete)/im.test(body)) throw unavailable();
  const source = /^URL Source:\s*(\S+)\s*$/im.exec(body)?.[1];
  if (!source || linkedInJobUrl(source) !== target) throw unavailable();
  const marker = /^Markdown Content:\s*$/im.exec(body);
  if (!marker) throw unavailable();
  return validateDescription(body.slice(marker.index + marker[0].length));
}

async function assertReadAllowed() {
  await require('./paidWork').assertRuntimeEnabled('jdAnalysis');
  const uid = deadline.current()?.userId;
  if (uid) await require('./deletionJob').assertNotDeleting(uid);
}

async function readWithJina(target, deadlineAt) {
  await deadline.bounded(() => require('./paidWork').beforePaidCall('jdAnalysis'), { deadlineAt, label: 'linkedinReaderGuard' });
  return deadline.bounded(async signal => {
    const response = await fetch('https://r.jina.ai/' + target, {
      signal, redirect: 'error', headers: {
        // Use Reader's default envelope. X-Respond-With:text returns bare
        // innerText and drops the source URL needed for identity validation.
        Accept: 'text/plain',
        'X-Target-Selector': '.show-more-less-html__markup',
        'X-Retain-Images': 'none', 'X-Retain-Links': 'text'
      }
    });
    let reader;
    try {
      if (!response.ok || !/^text\/(?:plain|markdown)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw unavailable();
      reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const chunks = []; let bytes = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_READER_BYTES) throw unavailable();
        chunks.push(Buffer.from(part.value));
      }
      return readerDescription(Buffer.concat(chunks).toString('utf8'), target);
    } finally {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      else await response.body?.cancel().catch(() => {});
    }
  }, { deadlineAt, label: 'linkedinReader' });
}

async function fetchJobPosting(raw, { deadlineMs = 12000 } = {}) {
  const target = linkedInJobUrl(raw);
  if (!target) return fetchAndCleanContent(raw);
  const until = deadline.absolute(Math.min(12000, deadlineMs));
  await deadline.bounded(assertReadAllowed, { deadlineAt: until, label: 'linkedinReadGuard' });
  try {
    const result = await safeFetch(linkedInGuestUrl(target), { deadlineMs: Math.min(3500, until - Date.now()) });
    // The generic guard validates every redirect. Restrict the final page to
    // this exact guest endpoint too, so a public redirect cannot change the job.
    if (result.finalUrl !== linkedInGuestUrl(target)) throw unavailable();
    if (/no longer accepting applications|this job is no longer available/i.test(cleanHtmlToText(result.body))) throw unavailable();
    return { content: guestDescription(result.body), source: 'linkedin-guest' };
  } catch (error) { if (TERMINAL.has(error.code)) throw error; }
  if (until - Date.now() < 250) throw unavailable();
  try {
    const content = await readWithJina(target, until);
    return { content, source: 'jina-reader' };
  } catch (error) {
    if (TERMINAL.has(error.code)) throw error;
    throw unavailable();
  }
}

module.exports = { fetchJobPosting, linkedInJobUrl, validateDescription, guestDescription, readerDescription, MAX_READER_BYTES };
