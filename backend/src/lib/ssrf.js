/**
 * SSRF-safe outbound fetch for user-supplied URLs (website / JD scraping).
 *
 * Audit Finding 1. Only user-controlled destinations go through here; calls to
 * our trusted scraper API (api.scrape.do) intentionally do not.
 *
 * Defenses:
 *  - Protocol + port allowlist (http/https, 80/443).
 *  - Every resolved address is classified; loopback/private/link-local/
 *    reserved/IPv6-local (and IPv4-mapped / NAT64 equivalents) are rejected.
 *  - The socket is pinned to a validated IP via a custom lookup, closing the
 *    DNS-rebinding window between validation and connect.
 *  - Redirects are followed manually (max 5) and every hop is re-validated.
 *  - A single deadline covers connect + all hops + body read.
 *  - The response body is streamed with a hard byte ceiling and a content-type
 *    allowlist, so a huge or binary payload can't exhaust the Lambda.
 */
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const { QlueError, ERROR_CODES } = require('./errors');

const MAX_REDIRECTS = 5;
const DEFAULT_DEADLINE_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB ceiling for scraped HTML
const ALLOWED_PORTS = new Set([80, 443]);
const ALLOWED_CONTENT_TYPES = [
  'text/html', 'application/xhtml+xml', 'text/plain', 'application/xml', 'text/xml'
];
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function forbidden(message) {
  return new QlueError(message, ERROR_CODES.ACCESS_FORBIDDEN, 400);
}
function unreachable(message) {
  return new QlueError(message, ERROR_CODES.URL_UNREACHABLE, 400);
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = (n << 8) + octet;
  }
  return n >>> 0;
}

function inCidr(intIp, baseIp, maskBits) {
  const base = ipv4ToInt(baseIp);
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (intIp & mask) === (base & mask);
}

// True for anything that is not a public/global IPv4 unicast address.
function isBlockedIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return (
    inCidr(n, '0.0.0.0', 8) ||       // "this" network / unspecified
    inCidr(n, '10.0.0.0', 8) ||      // private
    inCidr(n, '100.64.0.0', 10) ||   // CGNAT
    inCidr(n, '127.0.0.0', 8) ||     // loopback
    inCidr(n, '169.254.0.0', 16) ||  // link-local (incl. cloud metadata 169.254.169.254)
    inCidr(n, '172.16.0.0', 12) ||   // private
    inCidr(n, '192.0.0.0', 24) ||    // IETF protocol assignments
    inCidr(n, '192.0.2.0', 24) ||    // TEST-NET-1
    inCidr(n, '192.168.0.0', 16) ||  // private
    inCidr(n, '198.18.0.0', 15) ||   // benchmarking
    inCidr(n, '198.51.100.0', 24) || // TEST-NET-2
    inCidr(n, '203.0.113.0', 24) ||  // TEST-NET-3
    inCidr(n, '224.0.0.0', 4) ||     // multicast
    inCidr(n, '240.0.0.0', 4)        // reserved + limited broadcast
  );
}

// Expand any textual IPv6 (compressed, mixed dotted-quad, zone-suffixed) into
// its full 16 bytes. Returns a Uint8Array(16) or null if unparseable.
//
// R-01: the previous string-prefix classifier only recognised an embedded IPv4
// when it was written in dotted-quad form. Node's URL parser normalises
// `::ffff:127.0.0.1` to the hex form `::ffff:7f00:1`, which slipped through and
// let a loopback destination pass validation. Classifying on the raw bytes
// removes the textual-form dependency entirely.
function ipv6ToBytes(ip) {
  let addr = String(ip).toLowerCase();
  const pct = addr.indexOf('%');
  if (pct !== -1) addr = addr.slice(0, pct); // strip zone id

  // A trailing dotted-quad ("::ffff:127.0.0.1") contributes the last 4 bytes.
  let tailBytes = null;
  const dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[1]);
    if (v4 === null) return null;
    tailBytes = [(v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff];
    addr = addr.slice(0, dotted.index); // strip the dotted-quad; may leave a trailing ':'
  }

  const doubleColon = addr.indexOf('::');
  let head, tail;
  if (doubleColon !== -1) {
    head = addr.slice(0, doubleColon).split(':').filter(Boolean);
    tail = addr.slice(doubleColon + 2).split(':').filter(Boolean);
  } else {
    head = addr.split(':').filter(Boolean);
    tail = [];
  }

  // Each hextet is 2 bytes; the dotted-quad tail (if any) is 2 hextets' worth.
  const tailHextetCount = tailBytes ? 2 : 0;
  const groups = head.length + tail.length + tailHextetCount;
  if (groups > 8) return null;
  if (doubleColon === -1 && groups !== 8) return null; // no zero-compression → must be full

  const bytes = [];
  const pushHextet = (h) => {
    if (!/^[0-9a-f]{1,4}$/.test(h)) throw new Error('bad hextet');
    const n = parseInt(h, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  };
  try {
    for (const h of head) pushHextet(h);
    const zeros = (8 - groups) * 2; // bytes filled by "::"
    for (let i = 0; i < zeros; i++) bytes.push(0);
    for (const h of tail) pushHextet(h);
    if (tailBytes) bytes.push(...tailBytes);
  } catch (_) {
    return null;
  }
  return bytes.length === 16 ? Uint8Array.from(bytes) : null;
}

function isBlockedIPv6(ip) {
  const b = ipv6ToBytes(ip);
  if (!b) return true; // unparseable → never connect

  const allZeroThrough = (n) => b.slice(0, n).every((x) => x === 0);

  // Embedded-IPv4 forms: classify the trailing 32 bits as IPv4.
  //  ::ffff:a.b.c.d  → IPv4-mapped (bytes 10-11 == 0xff)
  //  ::a.b.c.d       → IPv4-compatible (deprecated) / also catches ::1 range
  //  64:ff9b::/96    → NAT64 well-known prefix
  const v4 = (b[12] << 24 | b[13] << 16 | b[14] << 8 | b[15]) >>> 0;
  const dottedFromBytes = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  const isMapped = allZeroThrough(10) && b[10] === 0xff && b[11] === 0xff;
  const isCompat = allZeroThrough(12) && v4 !== 0 && v4 !== 1; // exclude :: and ::1 (handled below)
  const isNat64 = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b
    && b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 0
    && b[8] === 0 && b[9] === 0 && b[10] === 0 && b[11] === 0;
  if (isMapped || isCompat || isNat64) return isBlockedIPv4(dottedFromBytes);

  if (b.every((x) => x === 0)) return true;                       // :: unspecified
  if (allZeroThrough(15) && b[15] === 1) return true;             // ::1 loopback
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;       // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true;                        // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;       // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return true;                                 // ff00::/8 multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 doc
  return false;
}

function isBlockedAddress(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return isBlockedIPv4(ip);
  if (fam === 6) return isBlockedIPv6(ip);
  return true; // not a parseable IP literal — never connect to it directly
}

function parseUrl(raw) {
  if(typeof raw!=='string'||raw.length>4096)throw new QlueError('Invalid URL provided',ERROR_CODES.INVALID_URL,400);
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new QlueError('Invalid URL provided', ERROR_CODES.INVALID_URL, 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new QlueError('Only http(s) URLs are allowed', ERROR_CODES.INVALID_URL, 400);
  }
  if(url.username||url.password)throw forbidden('URL credentials are not allowed');
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (!ALLOWED_PORTS.has(port)) throw forbidden('URL port is not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, ''); // unwrap IPv6 literal
  if (!host) throw new QlueError('Invalid URL provided', ERROR_CODES.INVALID_URL, 400);
  if (net.isIP(host) && isBlockedAddress(host)) throw forbidden('URL host is not allowed');
  return { url, host, port };
}

// Defense-in-depth pre-check: every resolved address must be public. The pinned
// lookup below re-enforces this at connect time so a rebind can't slip through.
async function assertHostAllowed(host) {
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw forbidden('URL host is not allowed');
    return;
  }
  let results;
  try {
    results = await dns.lookup(host, { all: true });
  } catch (_) {
    throw unreachable('Could not resolve URL host');
  }
  if (!results || results.length === 0) throw unreachable('Could not resolve URL host');
  for (const r of results) {
    if (isBlockedAddress(r.address)) throw forbidden('URL resolves to a private address');
  }
}

// Custom DNS lookup handed to node's http/https agent. It re-resolves the host,
// rejects if ANY address is private, and pins the socket to a single validated
// IP. Because the address the socket connects to is the one we validated here,
// there is no gap for a DNS rebind to redirect us to a private host.
function pinnedLookup(hostname, options, callback) {
  // Node calls lookup(hostname, options, callback); options may be a bare
  // family number (legacy) or an object. R-01: when `all: true` the Node DNS
  // contract REQUIRES the callback to receive an ARRAY of {address, family}.
  // The previous implementation always returned a scalar, which — under Node's
  // default autoSelectFamily (`all: true`) — violated the contract and could
  // break ordinary hostname fetches. Honour both shapes.
  if (typeof options === 'function') { callback = options; options = {}; }
  const opts = (options && typeof options === 'object') ? options : {};
  const wantAll = opts.all === true;
  const famFilter = (typeof options === 'number') ? options : opts.family;

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) return callback(forbidden('URL host is not allowed'));
    const fam = net.isIP(hostname);
    return wantAll
      ? callback(null, [{ address: hostname, family: fam }])
      : callback(null, hostname, fam);
  }
  dns.lookup(hostname, { all: true }).then((results) => {
    if (!results || results.length === 0) return callback(unreachable('Could not resolve URL host'));
    for (const r of results) {
      if (isBlockedAddress(r.address)) return callback(forbidden('URL resolves to a private address'));
    }
    let picks = results;
    if (famFilter === 4 || famFilter === 6) {
      const filtered = results.filter((r) => r.family === famFilter);
      if (filtered.length) picks = filtered;
    }
    if (wantAll) {
      return callback(null, picks.map((r) => ({ address: r.address, family: r.family })));
    }
    callback(null, picks[0].address, picks[0].family);
  }).catch(() => callback(unreachable('Could not resolve URL host')));
}

// A single hop. Returns { redirect: <location> } for a 3xx we should follow, or
// { body, contentType, finalUrl } for a terminal response. Rejects on transport
// error, timeout, oversized body, or a disallowed status/content-type.
function requestOnce(parsed, deadlineAt) {
  return new Promise((resolve, reject) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return reject(unreachable('Timed out fetching URL'));

    // R-07: `timeout` below is only a socket-INACTIVITY timeout, so a body that
    // trickles bytes just under it can outlive the deadline indefinitely. This
    // absolute timer covers connect + headers + the full body read and tears
    // the request down the moment the operation deadline passes.
    let settled = false;
    const finish = (fn) => (arg) => { if (settled) return; settled = true; clearTimeout(deadlineTimer); fn(arg); };
    const done = finish(resolve);
    const fail = finish(reject);
    const deadlineTimer = setTimeout(() => {
      try { req.destroy(); } catch (_) { /* ignore */ }
      fail(unreachable('Timed out fetching URL'));
    }, remaining);

    const lib = parsed.url.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed.url,
      {
        method: 'GET',
        lookup: pinnedLookup,
        timeout: remaining,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        // Redirect: hand the Location back to the caller for re-validation.
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume(); // drain and discard
          return done({ redirect: res.headers.location });
        }

        if (status < 200 || status >= 300) {
          res.resume();
          return fail(unreachable(`URL returned HTTP ${status}`));
        }

        const contentType = (res.headers['content-type'] || '').toLowerCase();
        if (contentType && !ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t))) {
          res.resume();
          return fail(forbidden('URL content type is not allowed'));
        }

        const chunks = [];
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            res.destroy();
            fail(forbidden('URL response exceeds size limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => done({
          body: Buffer.concat(chunks).toString('utf8'),
          contentType,
          finalUrl: parsed.url.href,
        }));
        res.on('error', (err) => fail(unreachable(err.message || 'Error reading URL response')));
      }
    );

    req.on('timeout', () => req.destroy(unreachable('Timed out fetching URL')));
    req.on('error', (err) => fail(
      err instanceof QlueError ? err : unreachable(err.message || 'Could not fetch URL')
    ));
    req.end();
  });
}

/**
 * SSRF-safe GET. Validates the URL, pre-checks DNS, and follows up to
 * MAX_REDIRECTS hops, re-validating each Location against the same rules.
 * Resolves to { body, contentType, finalUrl } or throws a QlueError.
 */
async function safeFetch(rawUrl, { deadlineMs = DEFAULT_DEADLINE_MS } = {}) {
  const deadlineAt = Date.now() + deadlineMs;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = parseUrl(current);
    await require('./deadline').bounded(() => assertHostAllowed(parsed.host), {deadlineAt,label:'DNS'});
    const result = await requestOnce(parsed, deadlineAt);

    if (!result.redirect) return result;

    // Resolve the redirect target against the current URL before re-validating,
    // so a relative or scheme-relative Location can't bypass the checks.
    let next;
    try {
      next = new URL(result.redirect, parsed.url).href;
    } catch (_) {
      throw new QlueError('URL redirect target is invalid', ERROR_CODES.INVALID_URL, 400);
    }
    current = next;
  }
  throw forbidden('Too many redirects');
}

module.exports = {
  safeFetch,
  isBlockedAddress,
  isBlockedIPv4,
  isBlockedIPv6,
  ipv6ToBytes,
  pinnedLookup,
  parseUrl,
  MAX_RESPONSE_BYTES,
};
