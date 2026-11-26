import dns from 'node:dns';
import { fetch, Agent } from 'undici';
import {
  DNS_FALLBACKS,
  MAX_RETRIES,
  RATE_LIMIT_BACKOFF_MS,
  RATE_LIMIT_MAX_WAIT_MS,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
} from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// DNS lookup with per-host fallback (see DNS_FALLBACKS in config.js). Tries the host's own
// DNS first; if that fails, resolves the configured CNAME target instead. Once a host has
// fallen back, later lookups in this run skip straight to the target (no repeated timeouts).
const DNS_FAILURES = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT']);
const fellBack = new Set();

export function lookupWithFallback(hostname, options, callback) {
  const alias = DNS_FALLBACKS[hostname];
  if (alias && fellBack.has(hostname)) return dns.lookup(alias, options, callback);
  dns.lookup(hostname, options, (err, ...result) => {
    if (err && alias && DNS_FAILURES.has(err.code)) {
      fellBack.add(hostname);
      console.warn(`  ⚠ DNS for ${hostname} failed (${err.code}); resolving via ${alias}`);
      return dns.lookup(alias, options, callback);
    }
    callback(err, ...result);
  });
}

// Only the IP lookup changes — undici still sends the original hostname as TLS SNI and Host.
const dispatcher = new Agent({ connect: { lookup: lookupWithFallback } });

// Retry-After is either delta-seconds or an HTTP date. Returns ms, or null if absent/invalid.
function parseRetryAfter(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

// Per-host throttle that kicks in after a 429: every later request to that host this run is
// preceded by an extra pause, doubling on each further 429 (1s, 2s, 4s, capped at 8s). Once a
// site says "slow down", keeping the original pace just trips the limit again on the next page.
const hostThrottleMs = new Map();
function bumpThrottle(host) {
  hostThrottleMs.set(host, Math.min((hostThrottleMs.get(host) || 500) * 2, 8000));
}

// Shared retrying request: browser-like UA, timeout, exponential backoff on network
// errors / 5xx, and a much longer Retry-After-aware backoff on 429. Fails fast on other 4xx.
// Returns the raw response text.
async function requestText(url, { method = 'GET', headers = {}, body = null } = {}) {
  const host = new URL(url).host;
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const throttle = hostThrottleMs.get(host);
    if (throttle) await sleep(throttle);
    let retryAfterMs = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        redirect: 'follow',
        dispatcher,
        headers: { 'User-Agent': USER_AGENT, ...headers },
      });
      if (res.ok) return await res.text();
      if (res.status === 429) {
        lastError = new Error(`HTTP 429 for ${url}`);
        bumpThrottle(host);
        const hinted = parseRetryAfter(res.headers.get('retry-after'));
        retryAfterMs = Math.min(
          hinted ?? RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length) - 1],
          RATE_LIMIT_MAX_WAIT_MS,
        );
        await res.body?.cancel(); // free the connection; we don't need the error page
      } else if (res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
      } else {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_RETRIES) {
      if (retryAfterMs != null) {
        console.warn(`  ⚠ rate-limited (429) on ${url}; waiting ${Math.round(retryAfterMs / 1000)}s before retry`);
        await sleep(retryAfterMs);
      } else {
        await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s, …
      }
    }
  }
  // Node's fetch reports network failures as a bare "fetch failed"; the real reason
  // (ECONNRESET, ETIMEDOUT, ECONNREFUSED, TLS errors…) is on err.cause.
  const cause = lastError?.cause;
  const detail = cause ? ` (${[cause.code, cause.message].filter(Boolean).join(': ')})` : '';
  throw new Error(`Failed to fetch ${url} after ${MAX_RETRIES} attempts: ${lastError?.message}${detail}`);
}

/** GET a URL and return its body as text (HTML). */
export function politeFetch(url) {
  return requestText(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
}

/** POST a JSON body and parse the JSON response (used for GraphQL APIs). */
export async function politePostJson(url, payload, extraHeaders = {}) {
  const text = await requestText(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  });
  return JSON.parse(text);
}
