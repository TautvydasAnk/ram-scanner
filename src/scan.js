import { categories, REQUEST_DELAY_MS } from './config.js';
import { politeFetch } from './fetch.js';
import { extractProducts, discoverSubcategories } from './parse.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Status priority for the "best status seen" merge. The site under-reports stock on
// secondary listing views (shows in-stock items as OutOfStock) but never over-reports,
// so taking the highest-priority status seen for a product recovers the true state.
const STATUS_RANK = { InStock: 3, PreOrder: 2, OutOfStock: 1 };

function mergeProduct(existing, incoming) {
  if (!existing) return { ...incoming };
  const merged = { ...existing };
  // Best (highest-rank) status wins.
  if (STATUS_RANK[incoming.status] > STATUS_RANK[existing.status]) {
    merged.status = incoming.status;
  }
  // Fill any missing metadata from whichever page has it.
  for (const key of ['name', 'url', 'sku', 'price', 'currency', 'image']) {
    if ((merged[key] === null || merged[key] === undefined || merged[key] === '') &&
        incoming[key] !== null && incoming[key] !== undefined && incoming[key] !== '') {
      merged[key] = incoming[key];
    }
  }
  return merged;
}

/**
 * Scan every configured category: fetch the base page, discover its sub-categories,
 * fetch each, and merge all products by id using best-status-seen.
 * Returns a snapshot: { scannedAt, products: { [id]: product } }.
 */
export async function scan({ scannedAt, log = console.log } = {}) {
  const products = new Map();

  for (const category of categories) {
    log(`\n▶ Scanning ${category.name} (${category.baseUrl})`);
    const baseHtml = await politeFetch(category.baseUrl);
    const subUrls = discoverSubcategories(baseHtml, category.baseUrl);
    const extraUrls = category.extraUrls ?? [];
    // Dedup while preserving order; baseUrl stays first so index 0 reuses baseHtml.
    const pages = [...new Set([category.baseUrl, ...extraUrls, ...subUrls])];
    log(
      `  ${pages.length} pages to fetch ` +
        `(base + ${extraUrls.length} extra + ${subUrls.length} sub-categories)`,
    );

    for (let i = 0; i < pages.length; i++) {
      const url = pages[i];
      const html = i === 0 ? baseHtml : await politeFetch(url);
      const found = extractProducts(html);
      for (const p of found) {
        products.set(p.id, mergeProduct(products.get(p.id), p));
      }
      if (i < pages.length - 1) await sleep(REQUEST_DELAY_MS);
    }
  }

  const bucket = { InStock: 0, PreOrder: 0, OutOfStock: 0 };
  for (const p of products.values()) bucket[p.status]++;
  log(
    `\n✔ ${products.size} unique products ` +
      `(InStock ${bucket.InStock}, PreOrder ${bucket.PreOrder}, OutOfStock ${bucket.OutOfStock})`,
  );

  return {
    scannedAt,
    products: Object.fromEntries([...products.entries()].map(([id, p]) => [id, p])),
  };
}
