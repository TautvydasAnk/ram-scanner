import { SITE_ORIGIN, SKIP_SLUG } from './config.js';

// Minimal HTML entity decoder for product names (e.g. "Pokémon TCG: Scarlet &amp; Violet").
// The JSON-LD text is already JSON-unescaped by JSON.parse; this only handles the
// HTML entities that remain inside those strings.
export function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// Map a schema.org availability URL to a short status token.
function normalizeStatus(availability) {
  const tail = String(availability || '').split('/').pop();
  if (tail === 'InStock') return 'InStock';
  if (tail === 'PreOrder') return 'PreOrder';
  return 'OutOfStock'; // OutOfStock, SoldOut, Discontinued, unknown → treat as unavailable
}

/**
 * Extract products from a listing page's embedded JSON-LD.
 * Returns an array of normalized product objects.
 */
export function extractProducts(html) {
  const products = [];
  const blockRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = blockRe.exec(html)) !== null) {
    let data;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue; // ignore malformed / non-JSON blocks
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || item['@type'] !== 'Product') continue;
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      const id = String(item.productID ?? item.sku ?? '').trim();
      if (!id) continue;
      const price = offer?.price != null ? Number(offer.price) : null;
      products.push({
        id,
        name: decodeEntities(item.name)?.trim() ?? '(unnamed)',
        url: item.url || offer?.url || '',
        sku: item.sku ?? null,
        price: Number.isFinite(price) ? price : null,
        currency: offer?.priceCurrency ?? 'EUR',
        status: normalizeStatus(offer?.availability),
        image: typeof item.image === 'string' ? item.image : null,
      });
    }
  }
  return products;
}

/**
 * Discover on-site sub-category listing URLs from the base category page.
 * Skips the broken `rN-5` rating-filter duplicates. Returns absolute URLs (deduped).
 */
export function discoverSubcategories(html, baseUrl) {
  // Path prefix of the category, e.g. "/en/pokemon-tcg".
  const basePath = new URL(baseUrl).pathname.replace(/\/$/, '');
  const urls = new Set();
  const hrefRe = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRe.exec(html)) !== null) {
    let href = match[1];
    // Resolve relative links against the site origin.
    let abs;
    try {
      abs = new URL(href, SITE_ORIGIN);
    } catch {
      continue;
    }
    if (abs.origin !== SITE_ORIGIN) continue;
    // Only sub-paths one level below the category (…/pokemon-tcg/<slug>), not the
    // base itself, not deeper product pages (which end in .html), not the `?p=` pages.
    const rest = abs.pathname.startsWith(basePath + '/')
      ? abs.pathname.slice(basePath.length + 1)
      : null;
    if (!rest || rest.includes('/') || rest.endsWith('.html') || rest === '') continue;
    if (SKIP_SLUG.test(rest)) continue;
    // Normalize: keep the `_crawl=0` form the site uses; drop other query noise.
    abs.search = '?_crawl=0';
    urls.add(abs.toString());
  }
  return [...urls];
}
