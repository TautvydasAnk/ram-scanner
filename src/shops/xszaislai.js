import { politePostJson } from '../fetch.js';

// xszaislai.lt runs Magento PWA — a JS storefront backed by a GraphQL API. Scraping the
// HTML shell yields nothing (products load client-side), so we query GraphQL directly:
// it's structured and authoritative (name, sku, stock_status, price, url), and it returns
// out-of-stock items too, so back-in-stock detection works.
//
// We track TWO sources and union them by SKU:
//   1. the "pokemon asmodee" search — the broad Pokémon TCG set (~123 items). Plain
//      "pokemon" (~349) drags in plush/figures/toys the user doesn't care about.
//   2. the "promotion/promo10" category — a small curated list the shop updates first when
//      items arrive / restock, and which includes a few Pokémon items the search misses
//      (e.g. card albums not tagged "asmodee").

const ENDPOINT = 'https://www.xszaislai.lt/graphql';
const STORE = 'lt_LT';
const PAGE_SIZE = 100; // Magento caps page size at 100
const MAX_PAGES = 20; // safety cap
const SITE = 'https://www.xszaislai.lt';

// Product-list sources. Categories are resolved to an id at runtime (survives store changes).
const SEARCH_TERMS = ['pokemon asmodee'];
const CATEGORY_PATHS = ['promotion/promo10'];

// Stock is authoritative from GraphQL, but if the same SKU shows up in two sources keep the
// "better" status just in case of a timing difference between calls.
const STATUS_RANK = { InStock: 2, OutOfStock: 1 };

const listQuery = (selector, page) => `{
  products(${selector}, pageSize: ${PAGE_SIZE}, currentPage: ${page}) {
    total_count
    page_info { total_pages }
    items {
      sku
      name
      stock_status
      url_rewrites { url }
      price_range { minimum_price { final_price { value currency } } }
    }
  }
}`;

async function gql(query) {
  const res = await politePostJson(ENDPOINT, { query }, { Store: STORE });
  if (res.errors) throw new Error(`GraphQL error: ${JSON.stringify(res.errors).slice(0, 300)}`);
  return res.data;
}

function absorb(products, items) {
  for (const it of items ?? []) {
    if (!it?.sku) continue;
    const slug = it.url_rewrites?.[0]?.url;
    const fp = it.price_range?.minimum_price?.final_price;
    const incoming = {
      id: it.sku,
      name: it.name?.trim() || '(unnamed)',
      url: slug ? `${SITE}/${slug}` : SITE,
      price: fp?.value ?? null,
      currency: fp?.currency || 'EUR',
      status: it.stock_status === 'IN_STOCK' ? 'InStock' : 'OutOfStock',
    };
    const existing = products[it.sku];
    if (!existing || STATUS_RANK[incoming.status] > STATUS_RANK[existing.status]) {
      products[it.sku] = { ...existing, ...incoming };
    }
  }
}

// Page through one product-list source (a `search:` or `filter:` selector), absorbing items.
async function collectSource(products, selector, label, log) {
  let totalPages = 1;
  let before = Object.keys(products).length;
  for (let page = 1; page <= MAX_PAGES && page <= totalPages; page++) {
    const data = await gql(listQuery(selector, page));
    const p = data?.products;
    if (!p) throw new Error('GraphQL: unexpected response shape');
    totalPages = p.page_info?.total_pages ?? 1;
    absorb(products, p.items);
  }
  log(`  ${label}: +${Object.keys(products).length - before} new (running ${Object.keys(products).length})`);
}

async function resolveCategoryId(path) {
  const data = await gql(`{ urlResolver(url: "${path}") { id type } }`);
  const r = data?.urlResolver;
  return r && r.type === 'CATEGORY' ? r.id : null;
}

async function scan({ log = console.log } = {}) {
  const products = {};

  for (const term of SEARCH_TERMS) {
    await collectSource(products, `search: "${term}"`, `search "${term}"`, log);
  }

  for (const path of CATEGORY_PATHS) {
    try {
      const id = await resolveCategoryId(path);
      if (!id) {
        log(`  ⚠ category "${path}" not found — skipping (search still covers most items)`);
        continue;
      }
      await collectSource(products, `filter: {category_id: {eq: "${id}"}}`, `category ${path} (id ${id})`, log);
    } catch (err) {
      // Don't fail the whole shop if just the promo category hiccups.
      log(`  ⚠ category "${path}" failed: ${err.message} — skipping`);
    }
  }

  const inStock = Object.values(products).filter((p) => p.status === 'InStock').length;
  log(`✔ ${Object.keys(products).length} products — InStock ${inStock}`);
  return products;
}

export const xszaislai = {
  id: 'xszaislai',
  name: 'Žaislų pasaulis (xszaislai.lt) — Pokémon',
  stateFile: 'data/state-xszaislai.json',
  scan,
};
