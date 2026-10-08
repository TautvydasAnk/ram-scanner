import { MAX_RETRIES, REQUEST_TIMEOUT_MS, USER_AGENT } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared retrying request: browser-like UA, timeout, exponential backoff on network
// errors / 5xx / 429. Fails fast on other 4xx. Returns the raw response text.
async function requestText(url, { method = 'GET', headers = {}, body = null } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, ...headers },
      });
      if (res.ok) return await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
      } else {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_RETRIES) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s, …
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
