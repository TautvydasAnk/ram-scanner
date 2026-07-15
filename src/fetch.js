import { MAX_RETRIES, REQUEST_TIMEOUT_MS, USER_AGENT } from './config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a URL as HTML text with browser-like headers, a timeout, and retry with
 * exponential backoff on network errors, 5xx, and 429. Returns the response body.
 * Throws after MAX_RETRIES failed attempts.
 */
export async function politeFetch(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (res.ok) {
        return await res.text();
      }
      // Retry transient statuses; fail fast on other 4xx (e.g. 404 = no such page).
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
    if (attempt < MAX_RETRIES) {
      await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s, …
    }
  }
  throw new Error(`Failed to fetch ${url} after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}
